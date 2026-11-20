// Every app's own data folder: kept across deploys and restarts.
//
// On the server it's /var/lib/deployboat/apps/<app>/data. Inside the app it's /data,
// and the app gets DATA_DIR=/data. Anything the app writes elsewhere is reset on every
// deploy, because each deploy starts a brand-new container.
import { existsSync, mkdirSync, chmodSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { run } from "./shell.ts";

export const DATA_DIR = "/data"; // the path inside the app

export const dataPath = (app: string) => join(config.dataDir, "apps", app, "data");

// Make sure the folder exists before the app starts.
export function ensureDataDir(app: string) {
  const dir = dataPath(app);
  mkdirSync(dir, { recursive: true });
  // Many images run the app as a non-root user, so the folder must be writable for any user.
  // That's safe: the parent folder (/var/lib/deployboat) is readable by root only,
  // and only this app's container can see the folder.
  try { chmodSync(dir, 0o777); } catch { /* not root, e.g. local dev */ }
}

// True if the app has saved anything in its data folder.
export const hasAppData = (app: string) => {
  const dir = dataPath(app);
  return existsSync(dir) && readdirSync(dir).length > 0;
};

// Size in bytes and number of files, for the dashboard.
export async function dataUsage(app: string) {
  const dir = dataPath(app);
  if (!existsSync(dir)) return { bytes: 0, files: 0 };
  // du -sk works on every system (sizes in KB); -b would be exact but is Linux-only.
  const bytes = (Number((await run("du", ["-sk", dir]).catch(() => "0")).split(/\s/)[0]) || 0) * 1024;
  const list = await run("find", [dir, "-type", "f"]).catch(() => "");
  return { bytes, files: list ? list.split("\n").filter(Boolean).length : 0 };
}

export function renameDataDir(oldApp: string, newApp: string) {
  const from = join(config.dataDir, "apps", oldApp);
  const to = join(config.dataDir, "apps", newApp);
  if (!existsSync(from) || existsSync(to)) return;
  mkdirSync(join(config.dataDir, "apps"), { recursive: true });
  renameSync(from, to);
}

export function removeDataDir(app: string) {
  rmSync(join(config.dataDir, "apps", app), { recursive: true, force: true });
}
