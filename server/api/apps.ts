// Dashboard routes for apps: list, details, deploys, logs, env vars, restart, delete.
import { Hono } from "hono";
import { db } from "../lib/db.ts";
import { getEnv, setEnv, deleteEnv, isBuiltin } from "../lib/env.ts";
import { appUrl } from "../deploy/index.ts";
import { containerState, appLogs, restart, remove, currentImage, activate, rename, stop, resume } from "../deploy/manage.ts";
import { filesHost, bucketName, usage, clientFor, enabled as hasStorage } from "../services/files/index.ts";
import * as s3 from "../lib/s3.ts";
import { enabled as hasDb, engineOf, typeOf as dbTypeOf, isDbType } from "../services/database/index.ts";
import { getGit, webhookSecret, setGitOptions } from "../deploy/git.ts";
import { previewsOf } from "../deploy/previews.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { resolveName, isStopped, displayName } from "../lib/db.ts";
import { domainsOf, domainOwner, addDomain, removeDomain, hostTaken, freeAddressOn, setFreeAddress } from "../lib/domains.ts";
import { checkDns, cleanHost, looksLikeHost } from "../lib/dns.ts";
import { syncRoutes } from "../deploy/route.ts";
import { config } from "../lib/config.ts";
import { share } from "./share.ts";
import { isAdmin } from "./auth.ts";
import { crons } from "./crons.ts";
import { enabledServices, addService, isService, parseService } from "../services/index.ts";
import { startRemoval, removalStatus } from "../services/removal.ts";
import { logLines } from "../lib/logs.ts";
import { DATA_DIR, extraFolders, saveExtraFolders } from "../lib/appdata.ts";

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
  const rows = db.prepare("SELECT id, status, image, created_at, finished_at, source, git_commit FROM deploys WHERE app = ? ORDER BY id DESC LIMIT 30").all(name) as (Deploy & { image: string | null })[];
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
    folders: [DATA_DIR, ...extraFolders(name)], // persistent storage, kept across deploys
    ...previewInfo(name),
    deploys,
  });
});

apps.get("/:name/deploys/:id", (c) => {
  const row = db.prepare("SELECT id, status, log, created_at FROM deploys WHERE app = ? AND id = ?")
    .get(c.req.param("name"), Number(c.req.param("id")));
  return row ? c.json(row) : c.json({ error: "Deploy not found." }, 404);
});

// The same logs as lines with a time and a level, for the Logs page. ?since= (like "2026-11-21T10:00:00Z")
// returns only newer lines, so the page can add to what it shows.
apps.get("/:name/logs/lines", async (c) => {
  const lines = Math.min(Number(c.req.query("lines")) || 500, 5000);
  return c.json(await logLines(c.req.param("name"), lines, c.req.query("since") || undefined));
});

// The latest runs of all the app's cron jobs, with their output.
apps.get("/:name/logs/crons", (c) => c.json(db.prepare(`
  SELECT r.id, r.started_at, r.duration_ms, r.status, r.attempts, r.output, j.name AS job
  FROM cron_runs r JOIN crons j ON j.id = r.cron_id
  WHERE j.app = ? ORDER BY r.id DESC LIMIT 100`).all(c.req.param("name"))));

apps.get("/:name/logs", async (c) => c.text(await appLogs(c.req.param("name"), Math.min(Number(c.req.query("lines")) || 200, 2000))));

apps.get("/:name/env", (c) => {
  const env = getEnv(c.req.param("name"));
  // Agent tokens see names only. Secrets stay in the dashboard.
  const showValues = isAdmin(c);
  return c.json(Object.entries(env).sort().map(([key, value]) => ({ key, ...(showValues && { value }), builtin: isBuiltin(key) })));
});

// Save one variable, then restart so the app sees it.
// Save variables, then restart once so the app sees them.
// One: { key, value }. Several at once (pasting a .env file, renaming): { vars: { KEY: "value" }, remove: ["OLD"] }.
const badKey = (key: string) =>
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `"${key}": names use letters, numbers and _ only, and can't start with a number.`
  : isBuiltin(key) || key === "PORT" || key === "DATA_DIR" ? `${key} is managed by Deploy Boat.` : null;

apps.put("/:name/env", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json().catch(() => ({}));
  const vars: Record<string, unknown> = body.vars && typeof body.vars === "object" ? body.vars : { [body.key ?? ""]: body.value };
  const remove: string[] = Array.isArray(body.remove) ? body.remove.map(String) : [];
  for (const key of [...Object.keys(vars), ...remove]) {
    const problem = badKey(key);
    if (problem) return c.json({ error: problem }, 400);
  }
  for (const key of remove) deleteEnv(name, key);
  for (const [key, value] of Object.entries(vars)) setEnv(name, key, String(value ?? ""));
  await restart(name).catch(() => {}); // fine if never deployed yet
  return c.json({ ok: true, saved: Object.keys(vars).length });
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

// --- Database (the Database page and its viewer) ---------------------------------

// Which database, how big, and its tables.
apps.get("/:name/database", async (c) => {
  const name = c.req.param("name");
  if (!hasDb(name)) return c.json({ type: null });
  const engine = engineOf(name);
  // If the database server is down, still show the page (with the error), so it can be fixed or deleted.
  let tables: unknown[] = [], error: string | null = null;
  try { tables = await engine.tables(name); } catch (e) { error = `Couldn't read the database: ${(e as Error).message}`; }
  return c.json({ type: dbTypeOf(name), label: engine.label, url: getEnv(name).DATABASE_URL, size: await engine.size(name).catch(() => null), tables, error });
});

// Runs `fn` with the app's database, and turns errors into friendly 400s.
async function withDb(c: any, fn: (name: string) => Promise<Response>) {
  const name = c.req.param("name");
  if (!hasDb(name)) return c.json({ error: "This app has no database yet." }, 404);
  try { return await fn(name); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
}

// One table: its columns and a page of rows (?page=0, 100 rows each).
apps.get("/:name/database/tables/:table", (c) => withDb(c, async (name) => {
  const engine = engineOf(name), table = c.req.param("table");
  if (!(await engine.tables(name)).some((t) => t.name === table)) throw new Error("Table not found.");
  const page = Math.max(0, Number(c.req.query("page")) || 0), limit = 100;
  const [columns, rows] = await Promise.all([engine.columns(name, table), engine.browse(name, table, page * limit, limit)]);
  return c.json({ columns, rows, page, limit });
}));

// Run any SQL, as the app's own database user. At most 1000 rows come back.
apps.post("/:name/database/query", (c) => withDb(c, async (name) => {
  const { sql } = await c.req.json().catch(() => ({}));
  if (!String(sql ?? "").trim()) throw new Error("Type some SQL first.");
  const started = Date.now();
  const result = await engineOf(name).query(name, String(sql), 1000);
  return c.json({ ...result, ms: Date.now() - started });
}));

// Persistent storage: /data is always there; save the extra folders, then restart
// so the new container has them.
apps.put("/:name/folders", async (c) => {
  const name = c.req.param("name");
  const { folders } = await c.req.json<{ folders: string[] }>();
  try { saveExtraFolders(name, Array.isArray(folders) ? folders.map(String) : []); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
  await restart(name).catch(() => {}); // fine if it was never deployed
  return c.json({ ok: true, folders: [DATA_DIR, ...extraFolders(name)] });
});

apps.get("/:name/storage", async (c) => {
  const name = c.req.param("name");
  const env = getEnv(name);
  return c.json({
    bucket: bucketName(name),
    publicUrl: `https://${filesHost(name)}`,
    endpoint: env.S3_ENDPOINT ?? null,
    region: env.S3_REGION ?? null,
    accessKey: env.S3_ACCESS_KEY ?? null,
    secretKey: env.S3_SECRET_KEY ?? null,
    ...(await usage(name)),
  });
});

// --- Storage file browser (the Storage page) ---------------------------------------

// A file name in the bucket, like "avatars/42.png". Throws on odd ones.
function storageKey(raw: unknown) {
  const key = String(raw ?? "").replace(/^\/+/, "");
  if (!key || key.length > 1024 || key.split("/").some((p) => p === ".." || p === ".")) throw new Error("That's not a valid file name.");
  return key;
}
// Runs `fn` with an S3 client for the app's bucket, and turns errors into friendly 400s.
async function withBucket(c: any, fn: (client: s3.S3) => Promise<Response>) {
  const name = c.req.param("name");
  if (!hasStorage(name)) return c.json({ error: "This app has no storage yet." }, 404);
  try { return await fn(await clientFor(name)); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
}

// What's in one folder: ?prefix=avatars/ (empty for the top), &next= for the next page.
apps.get("/:name/storage/files", (c) => withBucket(c, async (client) => {
  const prefix = c.req.query("prefix") ?? "";
  return c.json(await s3.browse(client, prefix, c.req.query("next") || undefined));
}));

// Upload one file: the raw file is the body, its full name is ?key=.
apps.post("/:name/storage/files", (c) => withBucket(c, async (client) => {
  const key = storageKey(c.req.query("key"));
  const length = Number(c.req.header("content-length"));
  if (!Number.isFinite(length)) throw new Error("Upload size unknown. Try again.");
  const body = c.req.raw.body ?? new Uint8Array();
  await s3.put(client, key, body as ReadableStream, length, c.req.header("content-type") || "application/octet-stream");
  return c.json({ ok: true, key });
}));

// Delete one file, or a whole folder (?key=avatars/ with the slash).
apps.delete("/:name/storage/files", (c) => withBucket(c, async (client) => {
  const key = storageKey(c.req.query("key"));
  const keys = key.endsWith("/") ? (await s3.list(client, key)).map((o) => o.key) : [key];
  for (const k of keys) await s3.remove(client, k);
  return c.json({ ok: true, deleted: keys.length });
}));

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
  return c.json({
    address: appUrl(name), baseDomain: config.baseDomain, nipDomain: config.nipDomain, ip: config.publicIp,
    free: { on: freeAddressOn(name), host: `${name}.${config.baseDomain}`, backup: config.baseDomain !== config.nipDomain ? `${name}.${config.nipDomain}` : null },
    custom,
  });
});

// Check a domain name before adding it. Returns an error message, or null if it can be used.
function canUse(name: string, host: string) {
  if (!looksLikeHost(host)) return "That doesn't look like a domain. Example: myshop.com or www.myshop.com";
  const taken = hostTaken(host);
  if (taken) return taken;
  const owner = domainOwner(host);
  if (owner) return owner === name ? "Already added." : `This domain is used by ${displayName(owner)}.`;
  return null;
}

apps.post("/:name/domains", async (c) => {
  const name = c.req.param("name");
  const { host: raw } = await c.req.json().catch(() => ({}));
  const host = cleanHost(raw);
  const problem = canUse(name, host);
  if (problem) return c.json({ error: problem }, 400);
  addDomain(name, host);
  await syncRoutes();
  const dns = await checkDns(host);
  return c.json({ ok: true, ready: dns.ok, dns });
});

// Change a domain to another name (like www.myshop.com → shop.myshop.com).
apps.put("/:name/domains/:host", async (c) => {
  const name = c.req.param("name"), old = c.req.param("host");
  if (!domainsOf(name).includes(old)) return c.json({ error: "Domain not found." }, 404);
  const host = cleanHost((await c.req.json().catch(() => ({}))).host);
  if (host === old) return c.json({ ok: true });
  const problem = canUse(name, host);
  if (problem) return c.json({ error: problem }, 400);
  removeDomain(name, old);
  addDomain(name, host);
  await syncRoutes();
  return c.json({ ok: true });
});

apps.delete("/:name/domains/:host", async (c) => {
  const name = c.req.param("name"), host = c.req.param("host");
  // The app must keep at least one address.
  if (!freeAddressOn(name) && domainsOf(name).length <= 1) return c.json({ error: "This is the app's only address. Turn the free address back on first, or add another domain." }, 400);
  removeDomain(name, host);
  await syncRoutes();
  return c.json({ ok: true });
});

// Turn the free address (<name>.<server domain>) off or on. Off only when the app has a domain of its own.
apps.put("/:name/free-address", async (c) => {
  const name = c.req.param("name");
  const { on } = await c.req.json().catch(() => ({}));
  if (!on && !domainsOf(name).length) return c.json({ error: "Add a domain of your own first, so the app still has an address." }, 400);
  setFreeAddress(name, !!on);
  await syncRoutes();
  return c.json({ ok: true });
});

// Add a database or file storage to an app, then restart it so it sees the new variables.
apps.post("/:name/services/:service", async (c) => {
  const { name, service } = c.req.param();
  // "database" with { type } in the body, or the type as the name ("mysql", "sqlite", "postgres").
  const wanted = parseService(service);
  if (!wanted) return c.json({ error: "Use database (or postgres, mysql, sqlite) or storage." }, 400);
  const { type } = await c.req.json().catch(() => ({}));
  if (type !== undefined && !isDbType(type)) return c.json({ error: "Database type: postgres, mysql or sqlite." }, 400);
  if (isBusy(name)) return c.json({ error: "Wait until the current deploy finishes." }, 409);
  lock(name);
  try {
    await addService(name, wanted.service, () => {}, wanted.type ?? type);
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
// Remove a database or storage and DELETE its data. A backup of that part is made first
// (not for previews: their data is a throwaway copy). Runs in the background: the
// dashboard then asks GET …/removal how it's going.
apps.delete("/:name/services/:service", (c) => {
  const { name, service } = c.req.param();
  if (!isService(service)) return c.json({ error: "Use database or storage." }, 400);
  if (!enabledServices(name).includes(service)) return c.json({ ok: true, done: true });
  try { startRemoval(name, service, { backup: !previewInfo(name).previewOf }); }
  catch (e) { return c.json({ error: (e as Error).message }, 409); }
  return c.json({ ok: true, started: true });
});

apps.get("/:name/services/:service/removal", (c) => c.json(removalStatus(c.req.param("name"))));


// Put an app in a group (folder) on the Apps page. Empty = no group.
apps.put("/:name/group", async (c) => {
  const { group } = await c.req.json().catch(() => ({}));
  const value = String(group ?? "").trim().slice(0, 40);
  db.prepare("UPDATE apps SET group_name = ? WHERE name = ?").run(value || null, c.req.param("name"));
  return c.json({ ok: true });
});
