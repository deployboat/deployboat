// Doctor page: results, check now, describe a fix, run a fix, history.
import { Hono } from "hono";
import { report, runChecks, describeFix, startFix, history } from "../doctor/index.ts";

export const doctor = new Hono();

doctor.get("/", (c) => c.json(report()));

doctor.post("/check", async (c) => { await runChecks(); return c.json(report()); });

doctor.get("/fix/:id", async (c) => {
  try { return c.json(await describeFix(c.req.param("id"))); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

doctor.post("/fix/:id", (c) => {
  try { startFix(c.req.param("id")); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 409); }
});

doctor.get("/history", (c) => c.json(history()));
