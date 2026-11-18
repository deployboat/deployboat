// Live process list, read straight from /proc (Linux). CPU is measured over
// one second, like `top`, so it shows what's busy right now.
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import { run } from "./shell.ts";

const TICKS = 100;       // clock ticks per second on Linux
const PAGE = 4096;       // memory page size in bytes

type Raw = { pid: number; ticks: number; rss: number; name: string; cmd: string; uid: number; cgroup: string };

const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

function snapshot(): Map<number, Raw> {
  const out = new Map<number, Raw>();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    const stat = read(`/proc/${d}/stat`);
    if (!stat) continue;
    // The name is in brackets and may contain spaces; fields after it are space separated.
    const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(f[11]) + Number(f[12]); // utime + stime
    const rss = Number(f[21]) * PAGE;
    const cmd = read(`/proc/${d}/cmdline`).replace(/\0/g, " ").trim() || `[${name}]`;
    const uid = Number(read(`/proc/${d}/status`).match(/^Uid:\s+(\d+)/m)?.[1] ?? -1);
    out.set(Number(d), { pid: Number(d), ticks, rss, name, cmd, uid, cgroup: read(`/proc/${d}/cgroup`) });
  }
  return out;
}

// Per-core busy ticks from /proc/stat.
function coreTicks() {
  return read("/proc/stat").split("\n").filter((l) => /^cpu\d/.test(l)).map((l) => {
    const n = l.split(/\s+/).slice(1).map(Number);
    const idle = n[3] + n[4];
    return { idle, total: n.reduce((a, b) => a + b, 0) };
  });
}

function users() {
  const map = new Map<number, string>();
  for (const l of read("/etc/passwd").split("\n")) {
    const [name, , uid] = l.split(":");
    if (name) map.set(Number(uid), name);
  }
  return map;
}

// Docker container ID → name, so we can say which app a process belongs to.
async function containers() {
  const out = await run("docker", ["ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"]).catch(() => "");
  return new Map(out.split("\n").filter(Boolean).map((l) => l.split(" ") as [string, string]));
}

const LABELS: Record<string, string> = { caddy: "Web server", postgres: "Database", garage: "File storage", buildkit: "App builder" };
function owner(cgroup: string, names: Map<string, string>) {
  const id = cgroup.match(/[0-9a-f]{64}/)?.[0];
  if (id && names.has(id)) {
    const n = names.get(id)!;
    return n.startsWith("app-") ? `App: ${n.slice(4)}` : LABELS[n] ?? n;
  }
  if (cgroup.includes("deployboat.service")) return "Deploy Boat";
  return "";
}

export async function sample(sortBy: "cpu" | "memory", limit = 2000) {
  const a = snapshot(), coresA = coreTicks();
  await new Promise((r) => setTimeout(r, 1000));
  const b = snapshot(), coresB = coreTicks();
  const [names, who] = [await containers(), users()];

  const list = [...b.values()].map((p) => ({
    pid: p.pid,
    name: p.name,
    command: p.cmd.slice(0, 300),
    user: who.get(p.uid) ?? String(p.uid),
    owner: owner(p.cgroup, names),
    cpu: Math.max(0, ((p.ticks - (a.get(p.pid)?.ticks ?? p.ticks)) / TICKS) * 100), // % of one core
    memory: p.rss,
  }));
  list.sort((x, y) => (sortBy === "cpu" ? y.cpu - x.cpu || y.memory - x.memory : y.memory - x.memory));

  const cores = coresB.map((c, i) => {
    const total = c.total - coresA[i].total, idle = c.idle - coresA[i].idle;
    return total > 0 ? Math.round(((total - idle) / total) * 100) : 0;
  });

  // Memory breakdown from /proc/meminfo (values in kB).
  const mi = Object.fromEntries(read("/proc/meminfo").split("\n").filter(Boolean)
    .map((l) => { const [k, v] = l.split(":"); return [k, parseInt(v) * 1024]; }));
  const memory = {
    total: mi.MemTotal,
    available: mi.MemAvailable,
    used: mi.MemTotal - mi.MemAvailable,
    cache: (mi.Cached ?? 0) + (mi.Buffers ?? 0) + (mi.SReclaimable ?? 0),
    swapTotal: mi.SwapTotal,
    swapUsed: mi.SwapTotal - mi.SwapFree,
  };

  return { count: list.length, processes: list.slice(0, limit), cores, load: os.loadavg(), memory };
}
