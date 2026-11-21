// SQLite: no server. The database is one file in the app's /data folder,
// so it survives deploys and is already in every backup (see lib/appdata.ts).
// The app gets DATABASE_URL=file:/data/app.db and SQLITE_PATH=/data/app.db.
//
// The dashboard opens the same file with Node's built-in SQLite to show and edit it.
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getEnv, setEnv, deleteEnv } from "../../lib/env.ts";
import { dataPath, ensureDataDir, DATA_DIR } from "../../lib/appdata.ts";
import type { Engine, Result } from "./types.ts";

const FILE = "app.db";
const fileOf = (app: string) => join(dataPath(app), FILE);

// Open the file for one job, then close it. The app may be writing too: wait for it if busy.
function withDb<T>(app: string, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(fileOf(app))) throw new Error("The database file isn't there. Deploy the app, or create the database again.");
  const db = new DatabaseSync(fileOf(app));
  try { db.exec("PRAGMA busy_timeout = 5000"); return fn(db); }
  finally { db.close(); letAppWrite(app); }
}

// We run as root. If SQLite just made its side files (-wal, -shm), they belong to root,
// and an app running as another user couldn't write to its own database anymore.
function letAppWrite(app: string) {
  for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) {
    try { chmodSync(join(dataPath(app), f), 0o666); } catch { /* not there, or not root */ }
  }
}

// Values the browser can show: big numbers as text, binary as a short note.
const show = (v: unknown): string | number | null =>
  v === null || v === undefined ? null
  : typeof v === "bigint" ? v.toString()
  : v instanceof Uint8Array ? `(binary, ${v.length} bytes)`
  : (v as string | number);

const quote = (table: string) => `"${table.replace(/"/g, '""')}"`;

export const sqlite: Engine = {
  label: "SQLite",
  container: null,

  async provision(app, log) {
    if (getEnv(app).DATABASE_URL) return;
    log("→ Creating your SQLite database…");
    ensureDataDir(app);
    const file = fileOf(app);
    if (!existsSync(file)) {
      const db = new DatabaseSync(file);
      db.exec("PRAGMA journal_mode = WAL"); // lets the app write while the dashboard reads
      db.close();
    }
    letAppWrite(app); // the app may run as a non-root user (see appdata.ts for why that's safe)
    setEnv(app, "DATABASE_URL", `file:${DATA_DIR}/${FILE}`);
    setEnv(app, "SQLITE_PATH", `${DATA_DIR}/${FILE}`);
  },

  // The file lives in the app's data folder, which moves with the app. Nothing to do.
  async rename() {},

  async destroy(app) {
    for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) rmSync(join(dataPath(app), f), { force: true });
    deleteEnv(app, "DATABASE_URL");
    deleteEnv(app, "SQLITE_PATH");
  },

  async tables(app) {
    return withDb(app, (db) => {
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
      return names.map(({ name }) => {
        // Exact counts are cheap enough for small databases; give up on huge ones.
        try { return { name, rows: Number((db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get() as { n: number }).n) }; }
        catch { return { name, rows: null }; }
      });
    });
  },

  async columns(app, table) {
    return withDb(app, (db) => (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as any[]).map((c) => ({
      name: c.name, type: c.type || "any", nullable: !c.notnull, default: c.dflt_value === null ? null : String(c.dflt_value), key: c.pk > 0,
    })));
  },

  async browse(app, table, offset, limit) {
    return this.query(app, `SELECT * FROM ${quote(table)} LIMIT ${limit} OFFSET ${offset}`, limit);
  },

  async query(app, sql, maxRows): Promise<Result> {
    return withDb(app, (db) => {
      const stmt = db.prepare(sql); // one statement at a time
      const columns = stmt.columns().map((c) => c.name);
      if (!columns.length) {
        const r = stmt.run();
        return { columns: [], rows: [], message: `Done. ${r.changes} row${r.changes === 1 ? "" : "s"} changed.` };
      }
      const rows: Result["rows"] = [];
      let truncated = false;
      for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
        if (rows.length >= maxRows) { truncated = true; break; }
        rows.push(columns.map((c) => show(row[c])));
      }
      return { columns, rows, truncated };
    });
  },

  async size(app) {
    let total = 0;
    for (const f of [FILE, `${FILE}-wal`]) total += statSync(join(dataPath(app), f), { throwIfNoEntry: false })?.size ?? 0;
    return total || null;
  },

  // Already in the backup: it's a file in /data.
  async dump() { return false; },
  async restore() {},
};
