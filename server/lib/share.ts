// Who can see an app: everyone (public), or only people with the password or a private link.
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";
import { run } from "./shell.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS share (
    app           TEXT PRIMARY KEY,
    mode          TEXT NOT NULL DEFAULT 'public',  -- public | password
    username      TEXT NOT NULL DEFAULT 'guest',
    password      TEXT,                            -- shown to the owner in the dashboard
    password_hash TEXT,                            -- what Caddy checks (bcrypt)
    token         TEXT                             -- private link secret
  );
`);

export type Share = { app: string; mode: "public" | "password"; username: string; password: string | null; password_hash: string | null; token: string | null };

export const getShare = (app: string): Share =>
  (db.prepare("SELECT * FROM share WHERE app = ?").get(app) as Share | undefined) ??
  { app, mode: "public", username: "guest", password: null, password_hash: null, token: null };

export const newToken = () => randomBytes(18).toString("hex");

// Caddy wants a bcrypt hash; it can make one for us.
const hash = (password: string) => run("docker", ["exec", "caddy", "caddy", "hash-password", "--plaintext", password]);

export async function setShare(app: string, mode: "public" | "password", username?: string, password?: string) {
  const cur = getShare(app);
  const user = (username ?? cur.username).trim() || "guest";
  let pass = cur.password, passHash = cur.password_hash;
  if (password && password !== cur.password) { pass = password; passHash = await hash(password); }
  db.prepare(`INSERT INTO share (app, mode, username, password, password_hash, token) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(app) DO UPDATE SET mode = excluded.mode, username = excluded.username,
      password = excluded.password, password_hash = excluded.password_hash, token = excluded.token`)
    .run(app, mode, user, pass, passHash, cur.token ?? newToken());
}

export function resetToken(app: string) {
  db.prepare("UPDATE share SET token = ? WHERE app = ?").run(newToken(), app);
}
