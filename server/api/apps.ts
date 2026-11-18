// Dashboard routes for apps: list, details, deploys, logs, env vars, restart, delete.
import { Hono } from "hono";
import { db } from "../lib/db.ts";
import { getEnv, setEnv, deleteEnv, isBuiltin } from "../lib/env.ts";
import { appUrl } from "../deploy/index.ts";
import { containerState, appLogs, restart, remove, currentImage, activate, rename, stop, resume } from "../deploy/manage.ts";
import { filesHost, bucketName, usage } from "../services/files/index.ts";
import { tables } from "../services/postgres/index.ts";
import { getGit, webhookSecret, setGitOptions } from "../deploy/git.ts";
import { previewsOf } from "../deploy/previews.ts";
import { backupNow } from "../backups/index.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { resolveName, isStopped, displayName } from "../lib/db.ts";
import { domainsOf, domainOwner, addDomain, removeDomain, hostTaken } from "../lib/domains.ts";
import { checkDns, cleanHost, looksLikeHost } from "../lib/dns.ts";
import { syncRoutes } from "../deploy/route.ts";
import { config } from "../lib/config.ts";
import { share } from "./share.ts";
import { isAdmin } from "./auth.ts";
import { crons } from "./crons.ts";
import { enabledServices, addService, removeService, isService } from "../services/index.ts";

export const apps = new Hono();

type Deploy = { id: number; status: string; created_at: string };
const lastDeploy = (app: string) =>
  db.prepare("SELECT id, status, created_at FROM deploys WHERE app = ? ORDER BY id DESC LIMIT 1").get(app) as Deploy | undefined;

const exists = (app: string) => !!db.prepare("SELECT 1 FROM apps WHERE name = ?").get(app);

// Custom order on the Apps page: the full list of names, top to bottom.
apps.put("/order", async (c) => {
  const { names } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(names)) return c.json({ error: "Send the app names in order." }, 400);
  const set = db.prepare("UPDATE apps SET sort_order = ? WHERE name = ?");
  names.forEach((n: string, i: number) => set.run(i, String(n)));
  return c.json({ ok: true });
});

// Stop early with 404 if the app doesn't exist.
apps.use("/:name/*", async (c, next) => {
  if (!exists(c.req.param("name"))) return c.json({ error: "App not found." }, 404);
  await next();
});

// Share and Crons pages live in their own files.
apps.route("/", share);
apps.route("/", crons);

// Git details for the dashboard, including the webhook address for auto-deploy.
function gitInfo(name: string) {
  const g = getGit(name);
  if (!g?.repo) return null;
  return {
    repo: g.repo, branch: g.branch, autoDeploy: !!g.auto_deploy, previews: !!g.previews, isPreview: !!g.ref,
    webhookUrl: `https://${config.dashboardHost}/hooks/${name}/${webhookSecret(name)}`,
    previewApps: previewsOf(name),
  };
}

const previewInfo = (name: string) => {
  const r = db.prepare("SELECT preview_of, pr FROM apps WHERE name = ?").get(name) as { preview_of: string | null; pr: number | null } | undefined;
  return { previewOf: r?.preview_of ?? null, pr: r?.pr ?? null };
};

apps.get("/", async (c) => {
  type Row = { name: string; created_at: string; sort_order: number | null; group_name: string | null; preview_of: string | null };
  const rows = db.prepare("SELECT name, created_at, sort_order, group_name, preview_of FROM apps ORDER BY created_at DESC").all() as Row[];
  const previewCount = (n: string) => rows.filter((r) => r.preview_of === n).length;
  const list = await Promise.all(rows.map(async ({ name, created_at, sort_order, group_name, preview_of }) => ({
    name,
    displayName: displayName(name),
    url: appUrl(name),
    previewOf: preview_of,
    previews: previewCount(name),
    createdAt: created_at,
    sortOrder: sort_order,
    group: group_name,
    services: enabledServices(name),
    state: await containerState(name),
    building: isBusy(name),
    stopped: isStopped(name),
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
    displayName: displayName(name),
    url: appUrl(name),
    services: enabledServices(name),
    filesUrl: enabledServices(name).includes("storage") ? `https://${filesHost(name)}` : null,
    state: await containerState(name),
    building: isBusy(name),
    stopped: isStopped(name),
    git: gitInfo(name),
    ...previewInfo(name),
    deploys,
  });
});

apps.get("/:name/deploys/:id", (c) => {
  const row = db.prepare("SELECT id, status, log, created_at FROM deploys WHERE app = ? AND id = ?")
    .get(c.req.param("name"), Number(c.req.param("id")));
  return row ? c.json(row) : c.json({ error: "Deploy not found." }, 404);
});

apps.get("/:name/logs", async (c) => c.text(await appLogs(c.req.param("name"), Math.min(Number(c.req.query("lines")) || 200, 2000))));

apps.get("/:name/env", (c) => {
  const env = getEnv(c.req.param("name"));
  // Agent tokens see names only. Secrets stay in the dashboard.
  const showValues = isAdmin(c);
  return c.json(Object.entries(env).sort().map(([key, value]) => ({ key, ...(showValues && { value }), builtin: isBuiltin(key) })));
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

apps.post("/:name/rename", async (c) => {
  const name = c.req.param("name");
  const { newName: raw } = await c.req.json().catch(() => ({}));
  const newName = String(raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(newName)) return c.json({ error: "Use letters, numbers and dashes only." }, 400);
  if (newName === name) return c.json({ ok: true, name });
  if (exists(newName) || resolveName(newName) !== newName) return c.json({ error: `The name ${newName} is already used.` }, 409);
  if (isBusy(name)) return c.json({ error: "Wait until the current deploy finishes." }, 409);

  lock(name);
  try { await rename(name, newName); return c.json({ ok: true, name: newName }); }
  catch (e) { return c.json({ error: `Rename failed: ${(e as Error).message}` }, 500); }
  finally { unlock(name); }
});

apps.post("/:name/stop", async (c) => {
  try { await stop(c.req.param("name")); return c.json({ ok: true }); }
  catch { return c.json({ error: "Couldn't stop the app. Is it running?" }, 400); }
});

apps.post("/:name/start", async (c) => {
  try { await resume(c.req.param("name")); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

// Free-text name for the dashboard. Doesn't change the address.
apps.put("/:name/display-name", async (c) => {
  const { displayName: raw } = await c.req.json().catch(() => ({}));
  const value = String(raw ?? "").trim().slice(0, 60);
  db.prepare("UPDATE apps SET display_name = ? WHERE name = ?").run(value || null, c.req.param("name"));
  return c.json({ ok: true });
});

apps.get("/:name/domains", async (c) => {
  const name = c.req.param("name");
  // Each domain with its DNS check: what's wrong and how to fix it.
  const custom = await Promise.all(domainsOf(name).map(async (host) => {
    const dns = await checkDns(host);
    return { host, ready: dns.ok, dns };
  }));
  return c.json({ address: appUrl(name), baseDomain: config.baseDomain, nipDomain: config.nipDomain, ip: config.publicIp, custom });
});

apps.post("/:name/domains", async (c) => {
  const name = c.req.param("name");
  const { host: raw } = await c.req.json().catch(() => ({}));
  const host = cleanHost(raw);
  if (!looksLikeHost(host)) return c.json({ error: "That doesn't look like a domain. Example: myshop.com or www.myshop.com" }, 400);
  const taken = hostTaken(host);
  if (taken) return c.json({ error: taken }, 400);
  const owner = domainOwner(host);
  if (owner) return c.json({ error: owner === name ? "Already added." : `This domain is used by ${displayName(owner)}.` }, 409);
  addDomain(name, host);
  await syncRoutes();
  const dns = await checkDns(host);
  return c.json({ ok: true, ready: dns.ok, dns });
});

apps.delete("/:name/domains/:host", async (c) => {
  removeDomain(c.req.param("name"), c.req.param("host"));
  await syncRoutes();
  return c.json({ ok: true });
});

// Add a database or file storage to an app, then restart it so it sees the new variables.
apps.post("/:name/services/:service", async (c) => {
  const { name, service } = c.req.param();
  if (!isService(service)) return c.json({ error: "Use database, storage or email." }, 400);
  if (isBusy(name)) return c.json({ error: "Wait until the current deploy finishes." }, 409);
  lock(name);
  try {
    await addService(name, service);
    await syncRoutes();
    await restart(name).catch(() => {}); // fine if it was never deployed
    return c.json({ ok: true, services: enabledServices(name) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  } finally {
    unlock(name);
  }
});

// Auto-deploy and PR preview switches; reset the webhook secret.
apps.put("/:name/git", async (c) => {
  const name = c.req.param("name");
  if (!getGit(name)?.repo) return c.json({ error: "This app isn't connected to a Git repo." }, 400);
  const b = await c.req.json().catch(() => ({}));
  setGitOptions(name, { autoDeploy: b.autoDeploy, previews: b.previews, resetSecret: !!b.resetSecret });
  return c.json({ ok: true, git: gitInfo(name) });
});

// Remove a database or storage and DELETE its data. A last backup is made first.
apps.delete("/:name/services/:service", async (c) => {
  const { name, service } = c.req.param();
  if (!isService(service)) return c.json({ error: "Use database, storage or email." }, 400);
  if (!enabledServices(name).includes(service)) return c.json({ ok: true, services: enabledServices(name) });
  if (isBusy(name)) return c.json({ error: "Wait until the current deploy finishes." }, 409);
  const isPreview = !!previewInfo(name).previewOf;
  if (!isPreview && service !== "email") { // email has no data to back up
    try { await backupNow(name); }
    catch (e) { return c.json({ error: `Couldn't make a last backup, so nothing was deleted: ${(e as Error).message}` }, 409); }
    const last = db.prepare("SELECT status, note FROM backups WHERE app = ? ORDER BY id DESC LIMIT 1").get(name) as { status: string; note: string } | undefined;
    if (last?.status !== "done") return c.json({ error: `The last backup failed, so nothing was deleted. ${last?.note ?? ""}` }, 409);
  }
  lock(name);
  try {
    await removeService(name, service);
    await syncRoutes();
    await restart(name).catch(() => {});
    return c.json({ ok: true, services: enabledServices(name) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  } finally {
    unlock(name);
  }
});

// Put an app in a group (folder) on the Apps page. Empty = no group.
apps.put("/:name/group", async (c) => {
  const { group } = await c.req.json().catch(() => ({}));
  const value = String(group ?? "").trim().slice(0, 40);
  db.prepare("UPDATE apps SET group_name = ? WHERE name = ?").run(value || null, c.req.param("name"));
  return c.json({ ok: true });
});
