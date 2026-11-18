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

// To add a check: write a file in checks/ and add it here.
export const CHECKS: Check[] = [services, apps, disk, memory, https, firewall, ssh, fail2ban, updates, reboot, time, version, backups];

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

const EVERY = 10 * 60 * 1000;
let results: Record<string, Result> = {};
let checkedAt: string | null = null;
let checking: Promise<void> | null = null;
let fixing: string | null = null;

export async function runChecks() {
  // If a check run is already going, wait for that one instead of starting another.
  checking ??= (async () => {
    const out = await Promise.all(CHECKS.map(async (c) => {
      try {
        return [c.id, await Promise.race([c.check(), timeout(30_000)])] as const;
      } catch (e) {
        return [c.id, { status: "info", message: "This check couldn't run.", detail: (e as Error).message } as Result] as const;
      }
    }));
    results = Object.fromEntries(out);
    checkedAt = new Date().toISOString();
    alertOnChanges();
  })().finally(() => (checking = null));
  return checking;
}

// Alert when a check turns red, and again when it's fixed. Not on every run.
// The last statuses are saved, so a restart doesn't re-send old alerts.
function alertOnChanges() {
  const before = getSetting<Record<string, string>>("doctor_last", {});
  const now: Record<string, string> = {};
  for (const c of CHECKS) {
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

const timeout = (ms: number) => new Promise<never>((_, fail) => setTimeout(() => fail(new Error("Took too long.")), ms));

// 100 when all is well. Problems cost 25, warnings 10.
function score() {
  const all = Object.values(results);
  return Math.max(0, 100 - all.filter((r) => r.status === "bad").length * 25 - all.filter((r) => r.status === "warn").length * 10);
}

export function report() {
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  const items = CHECKS.filter((c) => results[c.id]).map((c) => {
    const r = results[c.id];
    const showFix = c.fix && r.canFix !== false && r.status !== "ok";
    return { id: c.id, title: c.title, ...r, fix: showFix ? c.fix!.label : null };
  }).sort((a, b) => order[a.status] - order[b.status]);
  return { score: score(), checkedAt, checking: !!checking, fixing, items, issues: items.filter((i) => i.status === "bad" || i.status === "warn").length };
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
    .finally(() => { fixing = null; runChecks(); });
}

export const history = () => db.prepare("SELECT * FROM doctor_log ORDER BY id DESC LIMIT 30").all();

export function startDoctor() {
  db.prepare("UPDATE doctor_log SET status = 'failed', output = output || '\nDeploy Boat restarted during this fix.' WHERE status = 'running'").run();
  setTimeout(() => runChecks(), 15_000); // let Caddy & co. settle after a restart
  setInterval(() => runChecks(), EVERY);
}
