// Backups page: settings, list, back up now, restore, download, destinations.
import { Hono } from "hono";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { getSettings, saveSettings, publicSettings, backupNow, isRunning, currentLog, restore, listBackups, backupFile } from "../backups/index.ts";
import { remote } from "../backups/remote/index.ts";
import { startDeviceLogin, pollDeviceLogin, setupFolder } from "../backups/remote/gdrive.ts";

export const backups = new Hono();

backups.get("/", (c) => c.json({ settings: publicSettings(), running: isRunning(), log: currentLog(), backups: listBackups() }));

backups.put("/settings", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const s = getSettings();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time ?? s.time)) return c.json({ error: "Time should look like 03:00." }, 400);
  saveSettings({
    ...s,
    enabled: b.enabled ?? s.enabled,
    time: b.time ?? s.time,
    timezone: String(b.timezone ?? s.timezone),
    keep: Math.min(Math.max(Number(b.keep) || s.keep, 1), 60),
  });
  return c.json(publicSettings());
});

backups.post("/run", (c) => {
  const app = c.req.query("app");
  try { backupNow(app || undefined).catch(() => {}); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 409); }
});

backups.post("/:id/restore", async (c) => {
  try { const meta = await restore(Number(c.req.param("id"))); return c.json({ ok: true, meta }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

backups.get("/:id/download", (c) => {
  const file = backupFile(Number(c.req.param("id")));
  if (!file) return c.json({ error: "This backup isn't on the server." }, 404);
  try {
    c.header("content-type", "application/gzip");
    c.header("content-length", String(statSync(file).size));
    c.header("content-disposition", `attachment; filename="${file.split("/").pop()}"`);
    return c.body(Readable.toWeb(createReadStream(file)) as any);
  } catch { return c.json({ error: "This backup isn't on the server." }, 404); }
});

// --- destinations ---------------------------------------------------------------

backups.put("/remote/s3", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = {
    type: "s3" as const,
    endpoint: String(b.endpoint ?? "").trim().replace(/\/+$/, ""),
    region: String(b.region ?? "").trim() || "auto",
    bucket: String(b.bucket ?? "").trim(),
    accessKey: String(b.accessKey ?? "").trim(),
    secretKey: String(b.secretKey ?? "").trim(),
    prefix: String(b.prefix ?? "deployboat").trim(),
  };
  if (!/^https:\/\//.test(r.endpoint)) return c.json({ error: "The endpoint should start with https://" }, 400);
  if (!r.bucket || !r.accessKey || !r.secretKey) return c.json({ error: "Fill in the bucket and both keys." }, 400);
  try { await remote.test(r); }
  catch (e) { return c.json({ error: `Couldn't connect: ${(e as Error).message}` }, 400); }
  saveSettings({ ...getSettings(), remote: r });
  return c.json(publicSettings());
});

backups.delete("/remote", (c) => {
  saveSettings({ ...getSettings(), remote: null });
  return c.json(publicSettings());
});

// Google Drive, step 1: the user's own client ID + secret → a code to enter at google.com/device.
let pending: { clientId: string; clientSecret: string; deviceCode: string } | null = null;

backups.post("/remote/gdrive/start", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clientId = String(b.clientId ?? "").trim(), clientSecret = String(b.clientSecret ?? "").trim();
  if (!clientId.endsWith(".apps.googleusercontent.com")) return c.json({ error: "The client ID should end with .apps.googleusercontent.com" }, 400);
  if (!clientSecret) return c.json({ error: "Paste the client secret too." }, 400);
  try {
    const d = await startDeviceLogin(clientId);
    pending = { clientId, clientSecret, deviceCode: d.deviceCode };
    return c.json({ userCode: d.userCode, url: d.url, interval: d.interval });
  } catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

// Step 2: the dashboard asks every few seconds until the user has entered the code.
backups.post("/remote/gdrive/poll", async (c) => {
  if (!pending) return c.json({ error: "Start connecting first." }, 400);
  try {
    const r = await pollDeviceLogin(pending.clientId, pending.clientSecret, pending.deviceCode);
    if (r === "pending") return c.json({ status: "pending" });
    const creds = { clientId: pending.clientId, clientSecret: pending.clientSecret, refreshToken: r.refreshToken };
    const { folderId, email } = await setupFolder(creds);
    saveSettings({ ...getSettings(), remote: { type: "gdrive", ...creds, folderId, email } });
    pending = null;
    return c.json({ status: "connected", settings: publicSettings() });
  } catch (e) {
    pending = null;
    return c.json({ error: (e as Error).message }, 400);
  }
});
