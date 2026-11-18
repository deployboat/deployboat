// Tiny SQLite database (built into Node). One table per thing we store.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { config } from "./config.ts";

export const db = new DatabaseSync(join(config.dataDir, "deployboat.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    name       TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS deploys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    app        TEXT NOT NULL,
    status     TEXT NOT NULL,            -- building | live | failed
    log        TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Added later: which Docker image each deploy produced (for rollback).
try { db.exec("ALTER TABLE deploys ADD COLUMN image TEXT"); } catch { /* already there */ }

// Old app names → current name, so `deployboat deploy` keeps working after a rename.
db.exec("CREATE TABLE IF NOT EXISTS aliases (old TEXT PRIMARY KEY, name TEXT NOT NULL)");
export const resolveName = (name: string) =>
  (db.prepare("SELECT name FROM aliases WHERE old = ?").get(name) as { name: string } | undefined)?.name ?? name;
