// Cron jobs: run a URL or a command in an app on a schedule.
//
// Reliability rules:
//  - a job never overlaps itself (the next run waits)
//  - every run has a time limit
//  - failed runs are retried twice (after 30s, then 2 min)
//  - jobs are loaded again when Deploy Boat starts; runs missed while it was off are skipped
//  - stopped apps are skipped (and that's recorded)
import { Cron } from "croner";
import { spawn } from "node:child_process";
import { db, isStopped } from "../lib/db.ts";
import { containerName } from "../deploy/run.ts";
import { notify } from "../alerts/index.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS crons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    app        TEXT NOT NULL,
    name       TEXT NOT NULL,
    schedule   TEXT NOT NULL,             -- cron expression, e.g. "0 9 * * *"
    timezone   TEXT NOT NULL DEFAULT 'UTC',
    kind       TEXT NOT NULL,             -- url | command
    target     TEXT NOT NULL,             -- "/api/cleanup" or "npm run job"
    timeout    INTEGER NOT NULL DEFAULT 600,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cron_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cron_id     INTEGER NOT NULL,
    started_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    duration_ms INTEGER,
    status      TEXT NOT NULL,            -- running | ok | failed | skipped
    attempts    INTEGER DEFAULT 1,
    output      TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS cron_runs_by_job ON cron_runs (cron_id, id);
`);

export type Job = {
  id: number; app: string; name: string; schedule: string; timezone: string;
  kind: "url" | "command"; target: string; timeout: number; enabled: number;
};

const KEEP_RUNS = 50;
const RETRY_DELAYS = [30_000, 120_000];
const MAX_OUTPUT = 4000;

const timers = new Map<number, Cron>();
const running = new Set<number>();

export const getJob = (id: number) => db.prepare("SELECT * FROM crons WHERE id = ?").get(id) as Job | undefined;
export const jobsOf = (app: string) => db.prepare("SELECT * FROM crons WHERE app = ? ORDER BY id").all(app) as Job[];

// Throws if the schedule or time zone is invalid.
export function checkSchedule(schedule: string, timezone: string) {
  new Cron(schedule, { timezone, paused: true }).stop();
}

export const nextRun = (id: number) => timers.get(id)?.nextRun()?.toISOString() ?? null;
export const isRunning = (id: number) => running.has(id);

// --- running one job ---------------------------------------------------------

const clip = (s: string) => (s.length > MAX_OUTPUT ? "…" + s.slice(-MAX_OUTPUT) : s);

async function callUrl(job: Job): Promise<string> {
  // Called inside the server network, so it works even when the site has a password.
  const url = `http://${containerName(job.app)}:3000${job.target.startsWith("/") ? "" : "/"}${job.target}`;
  const res = await fetch(url, {
    headers: { "user-agent": "DeployBoat-Cron", "x-deployboat-cron": job.name },
    signal: AbortSignal.timeout(job.timeout * 1000),
  });
  const body = clip(await res.text().catch(() => ""));
  if (!res.ok) throw new Error(`HTTP ${res.status}\n${body}`);
  return `HTTP ${res.status}\n${body}`;
}

function runCommand(job: Job): Promise<string> {
  return new Promise((resolve, reject) => {
    // `timeout` inside the container stops the command itself, not just our connection to it.
    const child = spawn("docker", ["exec", containerName(job.app), "timeout", String(job.timeout), "sh", "-c", job.target]);
    let out = "";
    child.stdout.on("data", (d) => (out = clip(out + d)));
    child.stderr.on("data", (d) => (out = clip(out + d)));
    const killer = setTimeout(() => child.kill("SIGKILL"), (job.timeout + 15) * 1000); // safety net
    child.on("error", (e) => { clearTimeout(killer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve(out || "(no output)");
      else reject(new Error(code === 124 ? `Stopped after ${job.timeout}s (time limit)\n${out}` : `Exited with code ${code}\n${out}`));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runJob(id: number) {
  const job = getJob(id);
  if (!job || running.has(id)) return; // never overlap
  running.add(id);
  const started = Date.now();
  const { lastInsertRowid: runId } = db.prepare("INSERT INTO cron_runs (cron_id, status) VALUES (?, 'running')").run(id);
  const finish = (status: string, attempts: number, output: string) => {
    db.prepare("UPDATE cron_runs SET status = ?, attempts = ?, output = ?, duration_ms = ? WHERE id = ?")
      .run(status, attempts, output, Date.now() - started, runId);
    db.prepare(`DELETE FROM cron_runs WHERE cron_id = ? AND id NOT IN
      (SELECT id FROM cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT ${KEEP_RUNS})`).run(id, id);
  };

  try {
    if (isStopped(job.app)) return finish("skipped", 0, "App is stopped.");
    let lastError = "";
    for (let attempt = 1; attempt <= RETRY_DELAYS.length + 1; attempt++) {
      try {
        const out = job.kind === "url" ? await callUrl(job) : await runCommand(job);
        return finish("ok", attempt, out);
      } catch (e) {
        lastError = (e as Error).name === "TimeoutError" ? `Stopped after ${job.timeout}s (time limit)` : (e as Error).message;
        if (attempt <= RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt - 1]);
      }
    }
    finish("failed", RETRY_DELAYS.length + 1, clip(lastError));
    notify("cronFailed", `Cron job failed: ${job.name} (${job.app})`, clip(lastError).slice(0, 1000), `#/apps/${job.app}/crons`);
  } finally {
    running.delete(id);
  }
}

// --- scheduling ----------------------------------------------------------------

export function schedule(id: number) {
  unschedule(id);
  const job = getJob(id);
  if (!job || !job.enabled) return;
  try {
    timers.set(id, new Cron(job.schedule, { timezone: job.timezone, protect: true, name: `job-${id}` }, () => runJob(id)));
  } catch (e) {
    console.error(`Cron job ${id} has a bad schedule:`, (e as Error).message);
  }
}

export function unschedule(id: number) {
  timers.get(id)?.stop();
  timers.delete(id);
}

export function removeCrons(app: string) {
  for (const job of jobsOf(app)) {
    unschedule(job.id);
    db.prepare("DELETE FROM cron_runs WHERE cron_id = ?").run(job.id);
  }
  db.prepare("DELETE FROM crons WHERE app = ?").run(app);
}

// Called once when Deploy Boat starts.
export function startScheduler() {
  // Runs that were "running" when the server stopped never finished.
  db.prepare("UPDATE cron_runs SET status = 'failed', output = 'Deploy Boat restarted during this run.' WHERE status = 'running'").run();
  const ids = db.prepare("SELECT id FROM crons WHERE enabled = 1").all() as { id: number }[];
  ids.forEach(({ id }) => schedule(id));
  console.log(`Cron jobs scheduled: ${ids.length}`);
}
