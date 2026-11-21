// Pack one app's data into a single .tar.gz, and unpack it again.
//
//   <app>-<date>.tar.gz
//     meta.json        what's inside, when, which app
//     database.dump    pg_dump of the app's database (if it has one)
//     storage/…        every file in the app's storage bucket (if it has one)
//     data/…           the app's /data folder (DATA_DIR)
//     folders/…        its extra persistent folders, if it has any
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../lib/config.ts";
import { run } from "../lib/shell.ts";
import * as s3 from "../lib/s3.ts";
import { enabled as hasDatabase } from "../services/postgres/index.ts";
import { enabled as hasStorage, clientFor as storageOf } from "../services/files/index.ts";
import { hasAppData, dataPath, foldersPath, ensureDataDir } from "../lib/appdata.ts";
import { containerName } from "../deploy/network.ts";

const dbName = (app: string) => "app_" + app.replace(/-/g, "_");

// Run a command, with stdout going into a file (or stdin coming from one).
function pipeCmd(cmd: string, args: string[], io: { out?: string; in?: string }) {
  const child = spawn(cmd, args, { stdio: [io.in ? "pipe" : "ignore", io.out ? "pipe" : "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || `${cmd} failed`))));
  });
  // Wait for the file to be fully written (or read), not just for the command to end.
  const streamed = io.out ? pipeline(child.stdout!, createWriteStream(io.out))
    : io.in ? pipeline(createReadStream(io.in), child.stdin!) : Promise.resolve();
  return Promise.all([exited, streamed]).then(() => {});
}

export const hasData = (app: string) => hasDatabase(app) || hasStorage(app) || hasAppData(app);

// Make a backup file. Returns its path and what's in it.
export async function pack(app: string, log: (l: string) => void) {
  const dir = join(config.dataDir, "backups", app);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-11-18T03-00-00
  const file = join(dir, `${app}-${stamp}.tar.gz`);
  const tmp = mkdtempSync(join(config.dataDir, "backups", ".tmp-"));

  try {
    const meta = { app, createdAt: new Date().toISOString(), database: false, files: 0, dataFolder: false };

    if (hasDatabase(app)) {
      log("Saving database…");
      await pipeCmd("docker", ["exec", "postgres", "pg_dump", "-U", "postgres", "-Fc", dbName(app)], { out: join(tmp, "database.dump") });
      meta.database = true;
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
      if (!hasDatabase(app)) throw new Error("This backup has a database, but the app doesn't have one now. Create the database first, then restore.");
      log("Restoring database…");
      await run("docker", ["exec", "postgres", "psql", "-U", "postgres", "-tAc",
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName(app)}'`]);
      await pipeCmd("docker", ["exec", "-i", "postgres", "pg_restore", "-U", "postgres", "--clean", "--if-exists",
        "--no-owner", `--role=${dbName(app)}`, "-d", dbName(app)], { in: join(tmp, "database.dump") });
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
