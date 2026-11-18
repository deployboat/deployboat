// Server Doctor: runs every check every 10 minutes, keeps the latest results,
// and runs fixes in the background (one at a time), logging what they did.
import { db } from "../lib/db.ts";
import { getSetting, setSetting } from "../lib/settings.ts";
import { notify } from "../alerts/index.ts";
import type { Check, Result } from "./types.ts";
import { disk } from "./checks/disk.ts";
import { memory } from "./checks/memory.ts";
import { updates } from "./checks/updates.ts";
import { reboot } from "./checks/reboot.ts";
import { firewall } from "./checks/firewall.ts";
import { fail2ban } from "./checks/fail2ban.ts";
import { ssh } from "./checks/ssh.ts";
import { https } from "./checks/https.ts";
import { services } from "./checks/services.ts";
import { apps } from "./checks/apps.ts";
import { time } from "./checks/time.ts";
import { version } from "./checks/version.ts";
import { backups } from "./checks/backups.ts";
import { rootLogin } from "./checks/rootlogin.ts";
import { firewallPolicy } from "./checks/firewallpolicy.ts";
import { exposedPorts } from "./checks/exposedports.ts";
import { kernel } from "./checks/kernel.ts";
import { autoUpdates } from "./checks/autoupdates.ts";
import { emptyPasswords } from "./checks/emptypasswords.ts";
import { inodes } from "./checks/inodes.ts";
import { dockerSpace } from "./checks/dockerspace.ts";
import { journal } from "./checks/journal.ts";
import { oom } from "./checks/oom.ts";
import { load } from "./checks/load.ts";
import { failedUnits } from "./checks/failedunits.ts";
import { logins } from "./checks/logins.ts";
import { adminUsers } from "./checks/admins.ts";
import { sshKeys } from "./checks/sshkeys.ts";
import { extraPorts } from "./checks/extraports.ts";
import { dockerGroup } from "./checks/dockergroup.ts";
import { dataPerms } from "./checks/dataperms.ts";
import { oldTokens } from "./checks/oldtokens.ts";
import { eol } from "./checks/eol.ts";
import { internet } from "./checks/internet.ts";
import { swapUse } from "./checks/swapuse.ts";
import { database } from "./checks/database.ts";
import { storage } from "./checks/storage.ts";
import { domains } from "./checks/domains.ts";

// To add a check: write a file in checks/ and add it here.
export const CHECKS: Check[] = [
  // health
  services, apps, database, storage, disk, inodes, memory, swapUse, oom, load, dockerSpace, journal, failedUnits,
  https, domains, internet, backups, time, version,
  // security
  firewall, firewallPolicy, exposedPorts, extraPorts, ssh, rootLogin, sshKeys, adminUsers, emptyPasswords, dockerGroup,
  dataPerms, oldTokens, logins, fail2ban, updates, autoUpdates, kernel, reboot, eol,
];

// Shown as a small label on each check in the dashboard.
const SECURITY = new Set(["firewall", "firewallpolicy", "exposedports", "extraports", "ssh", "rootlogin", "sshkeys", "admins",
  "emptypasswords", "dockergroup", "dataperms", "oldtokens", "logins", "fail2ban", "updates", "autoupdates", "kernel", "reboot", "eol"]);

db.exec(`
  CREATE TABLE IF NOT EXISTS doctor_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id    TEXT NOT NULL,
    title       TEXT NOT NULL,
    started_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    status      TEXT NOT NULL,   -- running | done | failed
    output      TEXT DEFAULT ''
  );
`);

// --- how often each check runs -------------------------------------------------------
// Cheap and urgent: every 10 minutes. Slow-changing or heavier: hourly or daily.
// The user can change any of them (or set "manual") on the Doctor page.
export const FREQUENCIES = { "10m": 10 * 60_000, "1h": 60 * 60_000, "1d": 24 * 60 * 60_000, manual: Infinity } as const;
export type Every = keyof typeof FREQUENCIES;

const DEFAULT_EVERY: Record<string, Every> = {
  services: "10m", apps: "10m", disk: "10m", memory: "10m", load: "10m",
  https: "1h", firewall: "1h", firewallpolicy: "1h", exposedports: "1h", ssh: "1h", rootlogin: "1h", fail2ban: "1h",
  backups: "1h", oom: "1h", inodes: "1h", failedunits: "1h", reboot: "1h",
  updates: "1d", autoupdates: "1d", kernel: "1d", emptypasswords: "1d", dockerspace: "1d", journal: "1d", time: "1d", version: "1d",
  swapuse: "10m",
  logins: "1h", admins: "1h", sshkeys: "1h", extraports: "1h", internet: "1h", database: "1h", storage: "1h",
  dockergroup: "1d", dataperms: "1d", oldtokens: "1d", eol: "1d", domains: "1d",
};
const everyOf = (id: string): Every => getSetting<Record<string, Every>>("doctor_every", {})[id] ?? DEFAULT_EVERY[id] ?? "1h";

export function setEvery(id: string, every: Every) {
  if (!CHECKS.some((c) => c.id === id) || !(every in FREQUENCIES)) throw new Error("Unknown check or frequency.");
  setSetting("doctor_every", { ...getSetting<Record<string, Every>>("doctor_every", {}), [id]: every });
}

// --- results ---------------------------------------------------------------------------
// Saved after every run, so a restart doesn't need to re-run everything.
type Stored = Result & { checkedAt: string; ms: number };
let results: Record<string, Stored> = {};
const running = new Set<string>();
let fixing: string | null = null;

const MAX_AT_ONCE = 3;
const timeout = (ms: number) => new Promise<never>((_, fail) => setTimeout(() => fail(new Error("Took too long.")), ms));

async function runOne(c: Check) {
  running.add(c.id);
  const started = Date.now();
  let r: Result;
  try { r = await Promise.race([c.check(), timeout(30_000)]); }
  catch (e) { r = { status: "info", message: "This check couldn't run.", detail: (e as Error).message }; }
  results[c.id] = { ...r, checkedAt: new Date().toISOString(), ms: Date.now() - started };
  running.delete(c.id);
}

// Run the given checks, at most 3 at a time (no CPU spike).
export async function runChecks(ids?: string[]) {
  const todo = CHECKS.filter((c) => (!ids || ids.includes(c.id)) && !running.has(c.id));
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(MAX_AT_ONCE, queue.length) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) await runOne(c);
  }));
  setSetting("doctor_results", results);
  alertOnChanges(todo.map((c) => c.id));
}

// Which checks are due now, by their own schedule.
const due = () => CHECKS.filter((c) => {
  const every = FREQUENCIES[everyOf(c.id)];
  const last = results[c.id] ? Date.parse(results[c.id].checkedAt) : 0;
  return Number.isFinite(every) && Date.now() - last >= every;
}).map((c) => c.id);

// Alert when a check turns red, and again when it's fixed. Not on every run.
// The last statuses are saved, so a restart doesn't re-send old alerts.
function alertOnChanges(ids: string[]) {
  const before = getSetting<Record<string, string>>("doctor_last", {});
  const now = { ...before };
  for (const c of CHECKS.filter((x) => ids.includes(x.id))) {
    const r = results[c.id];
    if (!r) continue;
    now[c.id] = r.status;
    if (c.id === "backups") continue; // backups alert on their own, right when they fail
    const text = [r.message, r.detail].filter(Boolean).join("\n");
    if (r.status === "bad" && before[c.id] !== "bad")
      notify(c.id === "apps" ? "appDown" : "serverProblem", c.id === "apps" ? r.message : `${c.title}: problem`, text, r.link ?? "#/doctor");
    else if (before[c.id] === "bad" && (r.status === "ok" || r.status === "info"))
      notify("resolved", `Fixed: ${c.title}`, r.message, "#/doctor");
  }
  setSetting("doctor_last", now);
}

// 100 when all is well. Problems cost 25, warnings 10.
function score() {
  const all = Object.values(results);
  return Math.max(0, 100 - all.filter((r) => r.status === "bad").length * 25 - all.filter((r) => r.status === "warn").length * 10);
}

export function report() {
  const order = { bad: 0, warn: 1, info: 2, ok: 3, none: 4 };
  const items = CHECKS.map((c) => {
    const r = results[c.id];
    const base = { id: c.id, title: c.title, category: SECURITY.has(c.id) ? "Security" : "Health", every: everyOf(c.id), running: running.has(c.id) };
    if (!r) return { ...base, status: "none" as const, message: "Not checked yet.", fix: null, checkedAt: null, ms: null };
    const showFix = c.fix && r.canFix !== false && r.status !== "ok";
    return { ...base, ...r, fix: showFix ? c.fix!.label : null };
  }).sort((a, b) => order[a.status] - order[b.status]);
  const times = Object.values(results).map((r) => r.checkedAt).sort();
  return {
    score: score(), checkedAt: times.at(-1) ?? null, checking: running.size > 0, fixing, items,
    issues: items.filter((i) => i.status === "bad" || i.status === "warn").length,
    frequencies: Object.keys(FREQUENCIES),
  };
}

export async function describeFix(id: string) {
  const c = CHECKS.find((x) => x.id === id);
  if (!c?.fix) throw new Error("There's no fix for this.");
  return { label: c.fix.label, description: await c.fix.describe() };
}

// Start a fix in the background. Only one fix runs at a time.
export function startFix(id: string) {
  const c = CHECKS.find((x) => x.id === id);
  if (!c?.fix) throw new Error("There's no fix for this.");
  if (fixing) throw new Error("Another fix is running. Wait for it to finish.");

  fixing = id;
  const { lastInsertRowid: logId } = db.prepare("INSERT INTO doctor_log (check_id, title, status) VALUES (?, ?, 'running')").run(id, c.fix.label);
  const lines: string[] = [];
  const log = (l: string) => { lines.push(l); db.prepare("UPDATE doctor_log SET output = ? WHERE id = ?").run(lines.join("\n"), logId); };
  const end = (status: string) => db.prepare("UPDATE doctor_log SET status = ?, output = ? WHERE id = ?").run(status, lines.join("\n"), logId);

  c.fix.run(log)
    .then(() => end("done"), (e) => { log(`✗ ${(e as Error).message}`); end("failed"); })
    // Re-check what the fix touched (and the cheap checks it might affect).
    .finally(() => { fixing = null; runChecks([id, "disk", "inodes", "memory"]); });
}

export const history = () => db.prepare("SELECT * FROM doctor_log ORDER BY id DESC LIMIT 30").all();

export function startDoctor() {
  db.prepare("UPDATE doctor_log SET status = 'failed', output = output || '\nDeploy Boat restarted during this fix.' WHERE status = 'running'").run();
  results = getSetting<Record<string, Stored>>("doctor_results", {});
  // Every minute, run whatever is due. The first look waits a bit after a restart, so Caddy & co. can settle.
  setTimeout(() => {
    runChecks(due());
    setInterval(() => { const ids = due(); if (ids.length) runChecks(ids); }, 60_000);
  }, 15_000);
}
