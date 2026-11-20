// Who can see an app: everyone (public), or only people with the password or a private link.
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";
import { run } from "./shell.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS share (
    app           TEXT PRIMARY KEY,
    mode          TEXT NOT NULL DEFAULT 'public',  -- public | password
    username      TEXT NOT NULL DEFAULT 'guest',
    password_hash TEXT,                            -- what Caddy checks (bcrypt). The password itself is never stored.
    token         TEXT                             -- private link secret
  );
`);

// Older servers also kept the plain password, to show it in the dashboard. Remove it.
const columns = db.prepare("PRAGMA table_info(share)").all() as { name: string }[];
if (columns.some((c) => c.name === "password")) {
  db.exec("ALTER TABLE share DROP COLUMN password");
  db.exec("VACUUM"); // rewrite the file, so the old passwords don't linger in its free space
}

export type Share = { app: string; mode: "public" | "password"; username: string; password_hash: string | null; token: string | null };

export const getShare = (app: string): Share =>
  (db.prepare("SELECT * FROM share WHERE app = ?").get(app) as Share | undefined) ??
  { app, mode: "public", username: "guest", password_hash: null, token: null };

export const newToken = () => randomBytes(18).toString("hex");

// Caddy wants a bcrypt hash; it can make one for us.
const hash = (password: string) => run("docker", ["exec", "caddy", "caddy", "hash-password", "--plaintext", password]);

export async function setShare(app: string, mode: "public" | "password", username?: string, password?: string) {
  const cur = getShare(app);
  const user = (username ?? cur.username).trim() || "guest";
  // No new password = keep the old one.
  const passHash = password ? await hash(password) : cur.password_hash;
  db.prepare(`INSERT INTO share (app, mode, username, password_hash, token) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(app) DO UPDATE SET mode = excluded.mode, username = excluded.username,
      password_hash = excluded.password_hash, token = excluded.token`)
    .run(app, mode, user, passHash, cur.token ?? newToken());
}

export function resetToken(app: string) {
  db.prepare("UPDATE share SET token = ? WHERE app = ?").run(newToken(), app);
}
