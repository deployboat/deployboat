// Tiny SQLite database (built into Node). One table per thing we store.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { chmodSync } from "node:fs";
import { config } from "./config.ts";

export const db = new DatabaseSync(join(config.dataDir, "deployboat.db"));
try { chmodSync(join(config.dataDir, "deployboat.db"), 0o600); } catch { /* fine */ }

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

// Added later: 1 when the user stopped the app on purpose.
try { db.exec("ALTER TABLE apps ADD COLUMN stopped INTEGER DEFAULT 0"); } catch { /* already there */ }
export const setStopped = (app: string, stopped: boolean) =>
  db.prepare("UPDATE apps SET stopped = ? WHERE name = ?").run(stopped ? 1 : 0, app);
export const isStopped = (app: string) =>
  !!(db.prepare("SELECT stopped FROM apps WHERE name = ?").get(app) as { stopped: number } | undefined)?.stopped;

// Added later: a free-text name shown in the dashboard. The app's address uses `name`.
try { db.exec("ALTER TABLE apps ADD COLUMN display_name TEXT"); } catch { /* already there */ }
export const displayName = (app: string) =>
  (db.prepare("SELECT display_name FROM apps WHERE name = ?").get(app) as { display_name: string | null } | undefined)?.display_name || app;

// Added later: preview apps (one per pull request) point to their main app.
try { db.exec("ALTER TABLE apps ADD COLUMN preview_of TEXT"); } catch { /* already there */ }
try { db.exec("ALTER TABLE apps ADD COLUMN pr INTEGER"); } catch { /* already there */ }

// Added later: the user's own order and groups on the Apps page.
try { db.exec("ALTER TABLE apps ADD COLUMN sort_order INTEGER"); } catch { /* already there */ }
try { db.exec("ALTER TABLE apps ADD COLUMN group_name TEXT"); } catch { /* already there */ }
