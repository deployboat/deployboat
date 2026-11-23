// Doctor page: results, check now, describe a fix, run a fix, history.
import { Hono } from "hono";
import { report, runChecks, describeFix, startFix, history, setEvery, type Every } from "../doctor/index.ts";

import { privateStatus, checkStep, markStep, setTunnel } from "../doctor/private/index.ts";

export const doctor = new Hono();

doctor.get("/", (c) => c.json(report()));

// Check everything now (including manual-only checks), or one: /check?id=disk
doctor.post("/check", async (c) => {
  const id = c.req.query("id");
  await runChecks(id ? [id] : undefined);
  return c.json(report());
});

// How often one check runs: 10m, 1h, 1d or manual.
doctor.put("/every/:id", async (c) => {
  const { every } = await c.req.json().catch(() => ({}));
  try { setEvery(c.req.param("id"), every as Every); return c.json(report()); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

doctor.get("/fix/:id", async (c) => {
  try { return c.json(await describeFix(c.req.param("id"))); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

doctor.post("/fix/:id", (c) => {
  try { startFix(c.req.param("id")); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 409); }
});

doctor.get("/history", (c) => c.json(history()));

// "Make your server private": progress, check one step, tick one step, tunnel mode.
doctor.get("/private", (c) => c.json(privateStatus()));
doctor.post("/private/:id/check", async (c) => {
  try { return c.json(await checkStep(c.req.param("id"))); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});
doctor.put("/private/:id", async (c) => {
  const { done } = await c.req.json().catch(() => ({}));
  markStep(c.req.param("id"), !!done);
  return c.json(privateStatus());
});
doctor.put("/private-tunnel", async (c) => {
  const { on } = await c.req.json().catch(() => ({}));
  try { await setTunnel(!!on); return c.json(privateStatus()); }
  catch (e) { return c.json({ error: (e as Error).message }, 500); }
});
