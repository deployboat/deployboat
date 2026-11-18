// Postgres: one shared server, one database + user per app.
// The app gets DATABASE_URL. Nothing to set up.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../lib/config.ts";
import { getEnv, setEnv } from "../../lib/env.ts";
import { run } from "../../lib/shell.ts";

const CONTAINER = "postgres";
const IMAGE = "postgres:17";
const secret = () => randomBytes(16).toString("hex");

// Admin password, created once.
const adminFile = join(config.dataDir, "postgres-password");
if (!existsSync(adminFile)) writeFileSync(adminFile, secret(), { mode: 0o600 });

// Run one SQL statement as the admin. Returns the result as text.
const sql = (query: string) => run("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-tAc", query]);

async function ensureRunning(log: (l: string) => void) {
  const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER]).catch(() => "missing");
  if (state === "true") return;

  if (state === "missing") {
    log("→ Setting up the database server (first time only)…");
    await run("docker", [
      "run", "-d",
      "--name", CONTAINER,
      "--network", config.dockerNetwork,
      "--restart", "unless-stopped",
      "-e", `POSTGRES_PASSWORD=${readFileSync(adminFile, "utf8").trim()}`,
      "-v", `${join(config.dataDir, "postgres")}:/var/lib/postgresql/data`,
      IMAGE,
    ]);
  } else {
    await run("docker", ["start", CONTAINER]);
  }

  // Wait until Postgres accepts connections (up to 60s).
  for (let i = 0; i < 60; i++) {
    if (await run("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"]).then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The database server didn't start. Try deploying again.");
}

export async function provision(app: string, log: (l: string) => void) {
  await ensureRunning(log);

  // App names are already safe ([a-z0-9-]); Postgres prefers underscores.
  const name = "app_" + app.replace(/-/g, "_");
  if (getEnv(app).DATABASE_URL && (await sql(`SELECT 1 FROM pg_database WHERE datname='${name}'`))) return;

  log("→ Creating your database…");
  const password = secret();
  const roleExists = await sql(`SELECT 1 FROM pg_roles WHERE rolname='${name}'`);
  await sql(roleExists ? `ALTER ROLE ${name} PASSWORD '${password}'` : `CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
  if (!(await sql(`SELECT 1 FROM pg_database WHERE datname='${name}'`))) {
    await sql(`CREATE DATABASE ${name} OWNER ${name}`);
  }
  setEnv(app, "DATABASE_URL", `postgres://${name}:${password}@${CONTAINER}:5432/${name}`);
}

// Tables in the app's database with approximate row counts (for the dashboard).
export async function tables(app: string) {
  const name = "app_" + app.replace(/-/g, "_");
  const out = await run("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", name, "-tAc",
    "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname"]).catch(() => "");
  return out.split("\n").filter(Boolean).map((l) => {
    const [table, rows] = l.split("|");
    return { table, rows: Number(rows) };
  });
}

// Rename the app's database and user. Gives it a fresh password.
export async function rename(oldApp: string, newApp: string) {
  if (!getEnv(newApp).DATABASE_URL) return; // nothing created yet
  const from = "app_" + oldApp.replace(/-/g, "_"), to = "app_" + newApp.replace(/-/g, "_");
  await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${from}'`);
  await sql(`ALTER DATABASE ${from} RENAME TO ${to}`);
  await sql(`ALTER ROLE ${from} RENAME TO ${to}`);
  const password = secret();
  await sql(`ALTER ROLE ${to} PASSWORD '${password}'`);
  setEnv(newApp, "DATABASE_URL", `postgres://${to}:${password}@${CONTAINER}:5432/${to}`);
}
