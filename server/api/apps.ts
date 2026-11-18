// Dashboard routes for apps: list, details, deploys, logs, env vars, restart, delete.
import { Hono } from "hono";
import { db } from "../lib/db.ts";
import { getEnv, setEnv, deleteEnv, isBuiltin } from "../lib/env.ts";
import { appUrl } from "../deploy/index.ts";
import { containerState, appLogs, restart, remove, currentImage, activate } from "../deploy/manage.ts";
import { filesHost, bucketName, usage } from "../services/files/index.ts";
import { tables } from "../services/postgres/index.ts";
import { isBusy } from "../lib/lock.ts";

export const apps = new Hono();

type Deploy = { id: number; status: string; created_at: string };
const lastDeploy = (app: string) =>
  db.prepare("SELECT id, status, created_at FROM deploys WHERE app = ? ORDER BY id DESC LIMIT 1").get(app) as Deploy | undefined;

const exists = (app: string) => !!db.prepare("SELECT 1 FROM apps WHERE name = ?").get(app);

// Stop early with 404 if the app doesn't exist.
apps.use("/:name/*", async (c, next) => {
  if (!exists(c.req.param("name"))) return c.json({ error: "App not found." }, 404);
  await next();
});

apps.get("/", async (c) => {
  const rows = db.prepare("SELECT name FROM apps ORDER BY name").all() as { name: string }[];
  const list = await Promise.all(rows.map(async ({ name }) => ({
    name,
    url: appUrl(name),
    state: await containerState(name),
    building: isBusy(name),
    lastDeploy: lastDeploy(name) ?? null,
  })));
  return c.json(list);
});

apps.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (!exists(name)) return c.json({ error: "App not found." }, 404);
  const image = await currentImage(name);
  const rows = db.prepare("SELECT id, status, image, created_at FROM deploys WHERE app = ? ORDER BY id DESC LIMIT 30").all(name) as (Deploy & { image: string | null })[];
  // Don't send image names to the browser; just say which one is running.
  const deploys = rows.map(({ image: img, ...d }) => ({ ...d, current: !!img && img === image, canActivate: !!img && d.status === "live" }));
  return c.json({
    name,
    url: appUrl(name),
    filesUrl: `https://${filesHost(name)}`,
    state: await containerState(name),
    building: isBusy(name),
    deploys,
  });
});

apps.get("/:name/deploys/:id", (c) => {
  const row = db.prepare("SELECT id, status, log, created_at FROM deploys WHERE app = ? AND id = ?")
    .get(c.req.param("name"), Number(c.req.param("id")));
  return row ? c.json(row) : c.json({ error: "Deploy not found." }, 404);
});

apps.get("/:name/logs", async (c) => c.text(await appLogs(c.req.param("name"))));

apps.get("/:name/env", (c) => {
  const env = getEnv(c.req.param("name"));
  return c.json(Object.entries(env).sort().map(([key, value]) => ({ key, value, builtin: isBuiltin(key) })));
});

// Save one variable, then restart so the app sees it.
apps.put("/:name/env", async (c) => {
  const name = c.req.param("name");
  const { key, value } = await c.req.json().catch(() => ({}));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key ?? "")) return c.json({ error: "Name: letters, numbers and _ only. Can't start with a number." }, 400);
  if (isBuiltin(key) || key === "PORT") return c.json({ error: `${key} is managed by Deploy Boat.` }, 400);
  setEnv(name, key, String(value ?? ""));
  await restart(name).catch(() => {}); // fine if never deployed yet
  return c.json({ ok: true });
});

apps.delete("/:name/env/:key", async (c) => {
  const { name, key } = c.req.param();
  if (isBuiltin(key)) return c.json({ error: `${key} is managed by Deploy Boat.` }, 400);
  deleteEnv(name, key);
  await restart(name).catch(() => {});
  return c.json({ ok: true });
});

apps.post("/:name/restart", async (c) => {
  try { await restart(c.req.param("name")); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

apps.delete("/:name", async (c) => {
  const name = c.req.param("name");
  if (!exists(name)) return c.json({ error: "App not found." }, 404);
  if (isBusy(name)) return c.json({ error: "Wait until the current deploy finishes." }, 409);
  await remove(name);
  return c.json({ ok: true });
});

// Switch to an older version.
apps.post("/:name/versions/:id/activate", async (c) => {
  const { name, id } = c.req.param();
  const row = db.prepare("SELECT image FROM deploys WHERE app = ? AND id = ?").get(name, Number(id)) as { image: string | null } | undefined;
  if (!row?.image) return c.json({ error: "This version can't be restored." }, 400);
  try { await activate(name, row.image); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

apps.get("/:name/database", async (c) => {
  const name = c.req.param("name");
  return c.json({ url: getEnv(name).DATABASE_URL ?? null, tables: await tables(name) });
});

apps.get("/:name/storage", async (c) => {
  const name = c.req.param("name");
  const env = getEnv(name);
  return c.json({
    bucket: bucketName(name),
    publicUrl: `https://${filesHost(name)}`,
    endpoint: env.S3_ENDPOINT ?? null,
    accessKey: env.S3_ACCESS_KEY ?? null,
    secretKey: env.S3_SECRET_KEY ?? null,
    ...(await usage(name)),
  });
});
