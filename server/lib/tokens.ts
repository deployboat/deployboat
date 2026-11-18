// Agent tokens: limited tokens for the CLI and AI agents. We only store a
// SHA-256 hash, so a token is shown once, when it's created.
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    hash         TEXT NOT NULL UNIQUE,
    hint         TEXT NOT NULL,          -- last 4 characters, to tell tokens apart
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );
`);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createToken(name: string) {
  const token = "dba_" + randomBytes(24).toString("hex");
  db.prepare("INSERT INTO tokens (name, hash, hint) VALUES (?, ?, ?)").run(name, sha256(token), token.slice(-4));
  return token;
}

export const listTokens = () =>
  db.prepare("SELECT id, name, hint, created_at, last_used_at FROM tokens ORDER BY id DESC").all();

export const revokeToken = (id: number) => db.prepare("DELETE FROM tokens WHERE id = ?").run(id);

// Returns the token's id if it's valid. Notes when it was last used (at most once a minute).
export function checkToken(token: string): number | null {
  if (!token.startsWith("dba_")) return null;
  const row = db.prepare("SELECT id, last_used_at FROM tokens WHERE hash = ?").get(sha256(token)) as { id: number; last_used_at: string | null } | undefined;
  if (!row) return null;
  const last = row.last_used_at ? Date.parse(row.last_used_at + "Z") : 0;
  if (Date.now() - last > 60_000) db.prepare("UPDATE tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  return row.id;
}
