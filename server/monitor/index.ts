// Monitoring history: every minute, record server and app usage, and check that
// each app answers. Kept per minute for 48 hours, then as hourly averages for 30 days.
import { readFileSync } from "node:fs";
import os from "node:os";
import { db, isStopped, displayName } from "../lib/db.ts";
import { run } from "../lib/shell.ts";
import { containerName, containerIp } from "../deploy/network.ts";
import { notify } from "../alerts/index.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS metrics      (ts INTEGER NOT NULL, key TEXT NOT NULL, value REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS metrics_hour (ts INTEGER NOT NULL, key TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (key, ts));
  CREATE INDEX IF NOT EXISTS metrics_by_key ON metrics (key, ts);
`);

// Keys: "cpu", "mem", "disk" (server, in %), "app:<name>:cpu" (%), "app:<name>:mem" (bytes),
//       "app:<name>:up" (1 or 0), "app:<name>:ms" (response time).

const MINUTE = 60_000, HOUR = 3_600_000;

// --- server --------------------------------------------------------------------

let lastCpu: { idle: number; total: number } | null = null;
function cpuPercent() {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0].split(/\s+/).slice(1).map(Number);
  const now = { idle: line[3] + line[4], total: line.reduce((a, b) => a + b, 0) };
  const prev = lastCpu; lastCpu = now;
  if (!prev || now.total === prev.total) return null;
  return 100 * (1 - (now.idle - prev.idle) / (now.total - prev.total));
}

function memPercent() {
  const mi = Object.fromEntries(readFileSync("/proc/meminfo", "utf8").split("\n").filter(Boolean)
    .map((l) => { const [k, v] = l.split(":"); return [k, parseInt(v)]; }));
  return 100 * (1 - mi.MemAvailable / mi.MemTotal);
}

async function diskPercent() {
  const [, total, used] = (await run("df", ["-kP", "/"])).split("\n")[1].split(/\s+/).map(Number);
  return (100 * used) / total;
}

// --- apps ----------------------------------------------------------------------

// "12.5MiB" → bytes
const toBytes = (s = "") => {
  const m = s.match(/([\d.]+)\s*([KMGT]?i?B)/i);
  if (!m) return 0;
  const unit = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()] ?? 1;
  return Number(m[1]) * unit;
};

async function appStats() {
  const out = await run("docker", ["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"]).catch(() => "");
  return new Map(out.split("\n").filter(Boolean).map((l) => {
    const [name, cpu, mem] = l.split("\t");
    return [name, { cpu: parseFloat(cpu) || 0, mem: toBytes(mem.split("/")[0]) }];
  }));
}

// Does the app answer? Any response below 500 counts as up (a login page is fine).
async function ping(app: string) {
  const started = Date.now();
  try {
    const ip = await containerIp(app);
    if (!ip) return { up: false, ms: 0 };
    const res = await fetch(`http://${ip}:3000/`, { signal: AbortSignal.timeout(10_000), redirect: "manual", headers: { "user-agent": "DeployBoat-Uptime" } });
    await res.body?.cancel();
    return { up: res.status < 500, ms: Date.now() - started };
  } catch {
    return { up: false, ms: 0 };
  }
}

// Alert after 3 failed checks in a row; tell again when it's back.
const failures = new Map<string, number>();
function track(app: string, up: boolean) {
  const n = up ? 0 : (failures.get(app) ?? 0) + 1;
  const before = failures.get(app) ?? 0;
  failures.set(app, n);
  if (n === 3) notify("appDown", `${displayName(app)} isn't answering`, "It failed 3 checks in a row (one per minute).", `#/apps/${app}/logs`);
  if (up && before >= 3) notify("resolved", `${displayName(app)} is answering again`, "Uptime checks pass again.", `#/apps/${app}`);
}

// --- recording ------------------------------------------------------------------

const insert = db.prepare("INSERT INTO metrics (ts, key, value) VALUES (?, ?, ?)");

async function sample() {
  const ts = Math.floor(Date.now() / MINUTE) * MINUTE;
  const rows: [string, number][] = [];
  const cpu = cpuPercent();
  if (cpu !== null) rows.push(["cpu", cpu]);
  rows.push(["mem", memPercent()]);
  rows.push(["disk", await diskPercent().catch(() => 0)]);

  const apps = (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name).filter((a) => !isStopped(a));
  const stats = await appStats();
  await Promise.all(apps.map(async (app) => {
    const s = stats.get(containerName(app));
    if (s) rows.push([`app:${app}:cpu`, s.cpu], [`app:${app}:mem`, s.mem]);
    const p = await ping(app);
    rows.push([`app:${app}:up`, p.up ? 1 : 0]);
    if (p.up) rows.push([`app:${app}:ms`, p.ms]);
    track(app, p.up);
  }));

  for (const [k, v] of rows) insert.run(ts, k, v);
}

// Every hour: average the last full hour into metrics_hour, forget old rows.
function rollup() {
  const hour = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  db.prepare(`INSERT OR REPLACE INTO metrics_hour (ts, key, value)
    SELECT ?, key, AVG(value) FROM metrics WHERE ts >= ? AND ts < ? GROUP BY key`).run(hour, hour, hour + HOUR);
  db.prepare("DELETE FROM metrics WHERE ts < ?").run(Date.now() - 48 * HOUR);
  db.prepare("DELETE FROM metrics_hour WHERE ts < ?").run(Date.now() - 30 * 24 * HOUR);
}

export function startMonitor() {
  if (os.platform() !== "linux") return; // reads /proc
  cpuPercent(); // first reading, so the next one has something to compare to
  setInterval(() => sample().catch((e) => console.error("Monitor:", e.message)), MINUTE);
  setInterval(rollup, HOUR);
}

// --- reading ---------------------------------------------------------------------

export const RANGES = { "1h": HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR } as const;
export type Range = keyof typeof RANGES;

// One series, at most ~240 points: minutes for short ranges, hours for long ones.
export function series(key: string, range: Range) {
  const span = RANGES[range], since = Date.now() - span;
  const table = span > 48 * HOUR ? "metrics_hour" : "metrics";
  const step = Math.max(table === "metrics" ? MINUTE : HOUR, Math.ceil(span / 240 / MINUTE) * MINUTE);
  return (db.prepare(`SELECT (ts / ?) * ? AS t, AVG(value) AS v FROM ${table} WHERE key = ? AND ts >= ? GROUP BY t ORDER BY t`)
    .all(step, step, key, since) as { t: number; v: number }[]).map((r) => [r.t, Math.round(r.v * 100) / 100]);
}

// Uptime % over the range, plus a strip of up to 60 blocks (each: % up in that slice, or null = no data).
export function uptime(app: string, range: Range) {
  const span = RANGES[range], since = Date.now() - span;
  const table = span > 48 * HOUR ? "metrics_hour" : "metrics";
  const key = `app:${app}:up`;
  const overall = db.prepare(`SELECT AVG(value) AS v, COUNT(*) AS n FROM ${table} WHERE key = ? AND ts >= ?`).get(key, since) as { v: number | null; n: number };
  const slice = span / 60;
  const rows = db.prepare(`SELECT CAST((ts - ?) / ? AS INTEGER) AS i, AVG(value) AS v FROM ${table} WHERE key = ? AND ts >= ? GROUP BY i`)
    .all(since, slice, key, since) as { i: number; v: number }[];
  const blocks: (number | null)[] = Array(60).fill(null);
  for (const r of rows) if (r.i >= 0 && r.i < 60) blocks[r.i] = Math.round(r.v * 1000) / 10;
  return { percent: overall.n ? Math.round(overall.v! * 10000) / 100 : null, blocks, sliceMs: slice, since };
}
