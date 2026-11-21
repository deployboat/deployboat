// Pack one app's data into a single .tar.gz, and unpack it again.
//
//   <app>-<date>.tar.gz
//     meta.json        what's inside, when, which app
//     database.dump    pg_dump of the app's PostgreSQL database (if it has one)
//     database.sql     or a mysqldump of its MySQL database. SQLite is a file in data/.
//     storage/…        every file in the app's storage bucket (if it has one)
//     data/…           the app's /data folder (DATA_DIR)
//     folders/…        its extra persistent folders, if it has any
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { config } from "../lib/config.ts";
import { run } from "../lib/shell.ts";
import * as s3 from "../lib/s3.ts";
import { enabled as hasDatabase, engineOf, typeOf, ENGINES, isDbType } from "../services/database/index.ts";
import { enabled as hasStorage, clientFor as storageOf } from "../services/files/index.ts";
import { hasAppData, dataPath, foldersPath, ensureDataDir } from "../lib/appdata.ts";
import { containerName } from "../deploy/network.ts";

export const hasData = (app: string) => hasDatabase(app) || hasStorage(app) || hasAppData(app);

// Make a backup file. Returns its path and what's in it.
export async function pack(app: string, log: (l: string) => void) {
  const dir = join(config.dataDir, "backups", app);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-11-18T03-00-00
  const file = join(dir, `${app}-${stamp}.tar.gz`);
  const tmp = mkdtempSync(join(config.dataDir, "backups", ".tmp-"));

  try {
    // database: false, or the type ("postgres", "mysql"). Older backups say true: that's PostgreSQL.
    // SQLite has no dump: its file is in /data, saved below with the persistent folders.
    const meta = { app, createdAt: new Date().toISOString(), database: false as false | string, files: 0, dataFolder: false };

    if (hasDatabase(app) && typeOf(app) !== "sqlite") {
      log("Saving database…");
      if (await engineOf(app).dump(app, tmp)) meta.database = typeOf(app);
    }

    if (hasStorage(app)) {
      log("Saving stored files…");
      const store = await storageOf(app);
      for (const obj of await s3.list(store)) {
        const target = join(tmp, "storage", obj.key);
        if (relative(join(tmp, "storage"), target).startsWith("..")) continue; // odd key, skip
        mkdirSync(dirname(target), { recursive: true });
        await s3.download(store, obj.key, target);
        meta.files++;
      }
    }

    if (hasAppData(app)) {
      log("Saving persistent folders…");
      // Pause the app for the copy, so a file (like an SQLite database) isn't half-written.
      // Paused, not stopped: visitors just wait a moment, nothing restarts.
      const paused = await run("docker", ["pause", containerName(app)]).then(() => true, () => false);
      try {
        if (existsSync(dataPath(app))) await run("cp", ["-a", dataPath(app), join(tmp, "data")]);
        if (existsSync(foldersPath(app))) await run("cp", ["-a", foldersPath(app), join(tmp, "folders")]);
      }
      finally { if (paused) await run("docker", ["unpause", containerName(app)]).catch(() => {}); }
      meta.dataFolder = true;
    }

    writeFileSync(join(tmp, "meta.json"), JSON.stringify(meta, null, 2));
    await run("tar", ["-czf", file, "-C", tmp, "."]);
    return { file, meta };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Put a backup back. The app must be stopped first (see backups/index.ts).
export async function unpack(app: string, file: string, log: (l: string) => void) {
  const tmp = mkdtempSync(join(config.dataDir, "backups", ".restore-"));
  try {
    await run("tar", ["-xzf", file, "-C", tmp, "--no-same-owner"]);
    const meta = JSON.parse(readFileSync(join(tmp, "meta.json"), "utf8"));

    if (meta.database) {
      const type = meta.database === true ? "postgres" : meta.database;
      if (!isDbType(type)) throw new Error("This backup has a database type this server doesn't know.");
      const label = ENGINES[type].label;
      if (!hasDatabase(app)) throw new Error(`This backup has a ${label} database, but the app doesn't have one now. Create a ${label} database first, then restore.`);
      if (typeOf(app) !== type) throw new Error(`This backup has a ${label} database, but the app now uses ${engineOf(app).label}. It can't be restored into a different type.`);
      log("Restoring database…");
      await ENGINES[type].restore(app, tmp);
    }

    if (existsSync(join(tmp, "storage"))) {
      if (!hasStorage(app)) throw new Error("This backup has stored files, but the app doesn't have storage now. Create storage first, then restore.");
      log("Restoring stored files…");
      const store = await storageOf(app);
      // Make storage match the backup exactly: remove files that weren't in it.
      const keep = new Set(walk(join(tmp, "storage")).map((f) => relative(join(tmp, "storage"), f)));
      for (const obj of await s3.list(store)) if (!keep.has(obj.key)) await s3.remove(store, obj.key);
      for (const key of keep) await s3.upload(store, key, join(tmp, "storage", key));
      log(`${keep.size} files restored.`);
    }
    if (existsSync(join(tmp, "data")) || existsSync(join(tmp, "folders"))) {
      log("Restoring persistent folders…");
      // Make the folders match the backup exactly.
      rmSync(dataPath(app), { recursive: true, force: true });
      rmSync(foldersPath(app), { recursive: true, force: true });
      mkdirSync(dirname(dataPath(app)), { recursive: true });
      if (existsSync(join(tmp, "data"))) await run("cp", ["-a", join(tmp, "data"), dataPath(app)]);
      if (existsSync(join(tmp, "folders"))) await run("cp", ["-a", join(tmp, "folders"), foldersPath(app)]);
      ensureDataDir(app);
    }
    return meta;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
