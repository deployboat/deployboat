// Backups: every night (and on demand), one file per app that has data.
// Kept on this server, plus a copy off-server if one is set up.
// The newest `keep` backups of each app are kept; older ones are deleted in both places.
import { Cron } from "croner";
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db.ts";
import { config } from "../lib/config.ts";
import { getSetting, setSetting } from "../lib/settings.ts";
import { run } from "../lib/shell.ts";
import { containerName } from "../deploy/run.ts";
import { pack, unpack, hasData } from "./archive.ts";
import { remote, describe, type Remote } from "./remote/index.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS backups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    app           TEXT NOT NULL,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    status        TEXT NOT NULL,      -- running | done | failed
    file          TEXT,               -- on this server ('' after it's cleaned up)
    size          INTEGER,
    remote_id     TEXT,               -- id/key of the off-server copy
    remote_status TEXT,               -- uploaded | failed | null (no destination)
    note          TEXT DEFAULT ''     -- what's inside, or what went wrong
  );
`);

export type Settings = { enabled: boolean; time: string; timezone: string; keep: number; remote: Remote | null };
const DEFAULTS: Settings = { enabled: true, time: "03:00", timezone: "UTC", keep: 7, remote: null };

export const getSettings = () => getSetting<Settings>("backups", DEFAULTS);
export function saveSettings(s: Settings) { setSetting("backups", s); schedule(); }

// For the dashboard: never send secrets back.
export function publicSettings() {
  const s = getSettings();
  return { enabled: s.enabled, time: s.time, timezone: s.timezone, keep: s.keep, remote: describe(s.remote), remoteType: s.remote?.type ?? null };
}

let running: Promise<void> | null = null;
export const isRunning = () => !!running;
let log: string[] = [];
export const currentLog = () => log;

// Back up one app.
async function backupApp(app: string, say: (l: string) => void) {
  const { lastInsertRowid: id } = db.prepare("INSERT INTO backups (app, status) VALUES (?, 'running')").run(app);
  try {
    say(`${app}:`);
    const { file, meta } = await pack(app, (l) => say(`  ${l}`));
    const note = [meta.database && "database", meta.files && `${meta.files} files`].filter(Boolean).join(", ") || "empty";
    db.prepare("UPDATE backups SET status = 'done', file = ?, size = ?, note = ? WHERE id = ?").run(file, statSync(file).size, note, id);

    const r = getSettings().remote;
    if (r) {
      say("  Copying off-server…");
      try {
        const remoteId = await remote.upload(r, file, file.split("/").pop()!);
        db.prepare("UPDATE backups SET remote_id = ?, remote_status = 'uploaded' WHERE id = ?").run(remoteId, id);
      } catch (e) {
        db.prepare("UPDATE backups SET remote_status = 'failed', note = note || ? WHERE id = ?").run(` · off-server copy failed: ${(e as Error).message}`, id);
        say(`  Off-server copy failed: ${(e as Error).message}`);
      }
    }
    say("  Done.");
  } catch (e) {
    db.prepare("UPDATE backups SET status = 'failed', note = ? WHERE id = ?").run((e as Error).message, id);
    say(`  Failed: ${(e as Error).message}`);
  }
  await prune(app);
}

// Keep the newest `keep` good backups of an app; delete the rest here and off-server.
async function prune(app: string) {
  const { keep, remote: r } = getSettings();
  const old = db.prepare("SELECT * FROM backups WHERE app = ? AND status = 'done' ORDER BY id DESC LIMIT -1 OFFSET ?").all(app, keep) as any[];
  for (const b of old) {
    if (b.file) rmSync(b.file, { force: true });
    if (r && b.remote_id) await remote.remove(r, b.remote_id).catch(() => {});
    db.prepare("DELETE FROM backups WHERE id = ?").run(b.id);
  }
  db.prepare("DELETE FROM backups WHERE app = ? AND status = 'failed' AND id NOT IN (SELECT id FROM backups WHERE app = ? ORDER BY id DESC LIMIT 20)").run(app, app);
}

// Back up every app with data (or just one). Only one run at a time.
export function backupNow(only?: string) {
  if (running) throw new Error("A backup is already running.");
  log = [];
  const say = (l: string) => log.push(l);
  running = (async () => {
    const apps = only ? [only] : (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name).filter(hasData);
    if (!apps.length) say("No apps with a database or storage. Nothing to back up.");
    for (const app of apps) await backupApp(app, say);
  })().finally(() => (running = null));
  return running;
}

// Restore one backup. Downloads the off-server copy if the local file is gone.
export async function restore(id: number) {
  const b = db.prepare("SELECT * FROM backups WHERE id = ?").get(id) as any;
  if (!b || b.status !== "done") throw new Error("Backup not found.");
  if (running) throw new Error("A backup is running. Try again in a minute.");

  let file = b.file && existsSync(b.file) ? b.file : "";
  const r = getSettings().remote;
  if (!file) {
    if (!r || !b.remote_id) throw new Error("This backup isn't on the server anymore, and there's no off-server copy.");
    file = join(config.dataDir, "backups", b.app, `restore-${id}.tar.gz`);
    await remote.download(r, b.remote_id, file);
  }

  // Stop the app so nothing writes while we restore, then start it again.
  await run("docker", ["stop", containerName(b.app)]).catch(() => {});
  try {
    return await unpack(b.app, file, () => {});
  } finally {
    await run("docker", ["start", containerName(b.app)]).catch(() => {});
    if (file !== b.file) rmSync(file, { force: true });
  }
}

export const listBackups = () =>
  db.prepare("SELECT id, app, created_at, status, size, remote_status, note, file != '' AND file IS NOT NULL AS local FROM backups ORDER BY id DESC LIMIT 300").all();

export const backupFile = (id: number) => (db.prepare("SELECT file FROM backups WHERE id = ? AND status = 'done'").get(id) as { file: string } | undefined)?.file;

// For Doctor: how recent is the newest backup, and did the last ones work?
export function health() {
  const appsWithData = (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name).filter(hasData);
  const last = db.prepare("SELECT created_at FROM backups WHERE status = 'done' ORDER BY id DESC LIMIT 1").get() as { created_at: string } | undefined;
  const failed = (db.prepare("SELECT COUNT(*) AS n FROM backups WHERE status = 'failed' AND created_at > datetime('now', '-1 day')").get() as { n: number }).n;
  const remoteFailed = (db.prepare("SELECT COUNT(*) AS n FROM backups WHERE remote_status = 'failed' AND created_at > datetime('now', '-1 day')").get() as { n: number }).n;
  return { appsWithData: appsWithData.length, lastAt: last?.created_at ?? null, failed, remoteFailed, settings: getSettings() };
}

// --- schedule ------------------------------------------------------------------

let timer: Cron | null = null;
function schedule() {
  timer?.stop(); timer = null;
  const s = getSettings();
  if (!s.enabled) return;
  const [h, m] = s.time.split(":").map(Number);
  timer = new Cron(`${m} ${h} * * *`, { timezone: s.timezone, protect: true }, () => backupNow().catch(() => {}));
}

export function startBackups() {
  db.prepare("UPDATE backups SET status = 'failed', note = 'Deploy Boat restarted during this backup.' WHERE status = 'running'").run();
  schedule();
}
