// Crons page: list, add, edit, pause, delete, run now, history.
import { Hono } from "hono";
import { db } from "../lib/db.ts";
import { jobsOf, getJob, checkSchedule, schedule, unschedule, runJob, nextRun, isRunning } from "../crons/index.ts";

export const crons = new Hono();

const lastRun = (id: number) =>
  db.prepare("SELECT status, started_at, duration_ms FROM cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT 1").get(id) ?? null;

const view = (j: ReturnType<typeof getJob> & {}) => ({
  ...j, enabled: !!j.enabled, nextRun: nextRun(j.id), running: isRunning(j.id), lastRun: lastRun(j.id),
});

// Check and clean what the dashboard sends. Returns an error message or the clean values.
function parse(body: any) {
  const name = String(body.name ?? "").trim().slice(0, 60);
  const schedule = String(body.schedule ?? "").trim();
  const timezone = String(body.timezone ?? "UTC").trim() || "UTC";
  const kind = body.kind === "command" ? "command" : "url";
  const target = String(body.target ?? "").trim();
  const timeout = Math.min(Math.max(Number(body.timeout) || 600, 10), 3600);
  if (!name) return "Give the job a name.";
  if (!target) return kind === "url" ? "Enter the path to call, like /api/cleanup." : "Enter the command to run.";
  if (kind === "url" && !/^\/[^\s]*$/.test(target)) return "The path should start with /, like /api/cleanup.";
  try { checkSchedule(schedule, timezone); } catch { return "That schedule isn't valid."; }
  return { name, schedule, timezone, kind, target, timeout };
}

crons.get("/:name/crons", (c) => c.json(jobsOf(c.req.param("name")).map(view)));

crons.post("/:name/crons", async (c) => {
  const v = parse(await c.req.json().catch(() => ({})));
  if (typeof v === "string") return c.json({ error: v }, 400);
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO crons (app, name, schedule, timezone, kind, target, timeout) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(c.req.param("name"), v.name, v.schedule, v.timezone, v.kind, v.target, v.timeout);
  schedule(Number(lastInsertRowid));
  return c.json({ ok: true });
});

// Find a job that belongs to this app, or stop with 404.
const own = (c: any) => {
  const job = getJob(Number(c.req.param("id")));
  return job && job.app === c.req.param("name") ? job : null;
};

crons.put("/:name/crons/:id", async (c) => {
  const job = own(c);
  if (!job) return c.json({ error: "Job not found." }, 404);
  const v = parse(await c.req.json().catch(() => ({})));
  if (typeof v === "string") return c.json({ error: v }, 400);
  db.prepare("UPDATE crons SET name = ?, schedule = ?, timezone = ?, kind = ?, target = ?, timeout = ? WHERE id = ?")
    .run(v.name, v.schedule, v.timezone, v.kind, v.target, v.timeout, job.id);
  schedule(job.id);
  return c.json({ ok: true });
});

crons.post("/:name/crons/:id/toggle", (c) => {
  const job = own(c);
  if (!job) return c.json({ error: "Job not found." }, 404);
  db.prepare("UPDATE crons SET enabled = ? WHERE id = ?").run(job.enabled ? 0 : 1, job.id);
  job.enabled ? unschedule(job.id) : schedule(job.id);
  return c.json({ ok: true });
});

crons.post("/:name/crons/:id/run", (c) => {
  const job = own(c);
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (isRunning(job.id)) return c.json({ error: "It's already running." }, 409);
  runJob(job.id); // runs in the background; the history shows the result
  return c.json({ ok: true });
});

crons.delete("/:name/crons/:id", (c) => {
  const job = own(c);
  if (!job) return c.json({ error: "Job not found." }, 404);
  unschedule(job.id);
  db.prepare("DELETE FROM cron_runs WHERE cron_id = ?").run(job.id);
  db.prepare("DELETE FROM crons WHERE id = ?").run(job.id);
  return c.json({ ok: true });
});

crons.get("/:name/crons/:id/runs", (c) => {
  const job = own(c);
  if (!job) return c.json({ error: "Job not found." }, 404);
  return c.json(db.prepare("SELECT * FROM cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT 50").all(job.id));
});
