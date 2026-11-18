// Environment variables for each app (DATABASE_URL, S3_*, user values…).
import { db } from "./db.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS env (
    app   TEXT NOT NULL,
    key   TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (app, key)
  );
`);

export function getEnv(app: string): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM env WHERE app = ?").all(app) as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setEnv(app: string, key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO env (app, key, value) VALUES (?, ?, ?)").run(app, key, value);
}
