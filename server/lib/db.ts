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
