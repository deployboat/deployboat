// Every app's persistent storage: folders kept across deploys and restarts.
//
// Each deploy starts a brand-new container, so anything the app writes is reset,
// except in these folders. Every app gets /data (and DATA_DIR=/data). The user can add
// more folders, like /app/uploads, from the app's Overview.
//
// On the server:
//   /var/lib/deployboat/apps/<app>/data              → /data in the app
//   /var/lib/deployboat/apps/<app>/folders/<name>    → an extra folder, e.g. %2Fapp%2Fuploads → /app/uploads
import { existsSync, mkdirSync, chmodSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { run } from "./shell.ts";
import { getSetting, setSetting, deleteSetting } from "./settings.ts";

export const DATA_DIR = "/data"; // the path inside the app

const appDir = (app: string) => join(config.dataDir, "apps", app);
export const dataPath = (app: string) => join(appDir(app), "data");
export const foldersPath = (app: string) => join(appDir(app), "folders");

// The extra folders, as paths inside the app. Saved per app in the settings table.
export const extraFolders = (app: string) => getSetting<{ list: string[] }>(`folders:${app}`, { list: [] }).list;

// "/app/uploads" → "%2Fapp%2Fuploads": the folder's name on the server (unique for every path).
const onServerName = (inside: string) => encodeURIComponent(inside);

// Every persistent folder: [path inside the app, path on the server]. /data comes first.
export function mounts(app: string): [string, string][] {
  const list: [string, string][] = [[DATA_DIR, dataPath(app)]];
  for (const p of extraFolders(app)) list.push([p, join(foldersPath(app), onServerName(p))]);
  return list;
}

// Paths we refuse: the system ones, where a mount would break the container.
const SYSTEM = ["/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/sbin", "/sys", "/usr", "/var/run", "/run"];

// Check and save the extra folders. Throws a friendly message if one is wrong.
export function saveExtraFolders(app: string, list: string[]) {
  const clean = [...new Set(list.map((p) => p.trim().replace(/\/+$/, "")).filter(Boolean))];
  for (const p of clean) {
    if (!/^\/[A-Za-z0-9._\-/]+$/.test(p)) throw new Error(`"${p}" isn't a valid folder. Use a full path like /app/uploads.`);
    if (p.split("/").some((part) => part === "..")) throw new Error(`"${p}" can't contain "..".`);
    if (p === DATA_DIR || p.startsWith(`${DATA_DIR}/`)) throw new Error(`${p} is already inside /data, which is kept anyway.`);
    if (SYSTEM.includes(p)) throw new Error(`${p} is a system folder and can't be used.`);
  }
  if (clean.length > 10) throw new Error("At most 10 extra folders.");
  if (clean.length) setSetting(`folders:${app}`, { list: clean }); else deleteSetting(`folders:${app}`);
  return clean;
}

// Make sure every folder exists before the app starts.
export function ensureDataDir(app: string) {
  for (const [, dir] of mounts(app)) {
    mkdirSync(dir, { recursive: true });
    // Many images run the app as a non-root user, so the folder must be writable for any user.
    // That's safe: the parent folder (/var/lib/deployboat) is readable by root only,
    // and only this app's container can see the folder.
    try { chmodSync(dir, 0o777); } catch { /* not root, e.g. local dev */ }
  }
}

// True if the app has saved anything in any of its folders.
export const hasAppData = (app: string) =>
  mounts(app).some(([, dir]) => existsSync(dir) && readdirSync(dir).length > 0);

// Size in bytes and number of files across all folders, for the dashboard.
export async function dataUsage(app: string) {
  let bytes = 0, files = 0;
  for (const [, dir] of mounts(app)) {
    if (!existsSync(dir)) continue;
    // du -sk works on every system (sizes in KB); -b would be exact but is Linux-only.
    bytes += (Number((await run("du", ["-sk", dir]).catch(() => "0")).split(/\s/)[0]) || 0) * 1024;
    const list = await run("find", [dir, "-type", "f"]).catch(() => "");
    files += list ? list.split("\n").filter(Boolean).length : 0;
  }
  return { bytes, files };
}

export function renameDataDir(oldApp: string, newApp: string) {
  const extra = extraFolders(oldApp);
  if (extra.length) { setSetting(`folders:${newApp}`, { list: extra }); deleteSetting(`folders:${oldApp}`); }
  const from = appDir(oldApp), to = appDir(newApp);
  if (!existsSync(from) || existsSync(to)) return;
  mkdirSync(join(config.dataDir, "apps"), { recursive: true });
  renameSync(from, to);
}

export function removeDataDir(app: string) {
  deleteSetting(`folders:${app}`);
  rmSync(appDir(app), { recursive: true, force: true });
}
