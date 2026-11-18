// Small server-wide settings, stored as JSON by name (e.g. "backups").
import { db } from "./db.ts";

db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? { ...fallback, ...JSON.parse(row.value) } : fallback;
}

export function setSetting(key: string, value: unknown) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
}
