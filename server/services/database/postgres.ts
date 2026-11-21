// PostgreSQL: one shared server, one database + user per app.
// The app gets DATABASE_URL (postgres://app_shop:…@postgres:5432/app_shop).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../lib/config.ts";
import { getEnv, setEnv, deleteEnv } from "../../lib/env.ts";
import { run } from "../../lib/shell.ts";
import { capture, pipeFile } from "./exec.ts";
import type { Engine, Result } from "./types.ts";

const CONTAINER = "postgres";
const IMAGE = "postgres:17";
const secret = () => randomBytes(16).toString("hex");
export const dbName = (app: string) => "app_" + app.replace(/-/g, "_"); // names are [a-z0-9-]; Postgres prefers _

// Admin password, created once.
const adminFile = join(config.dataDir, "postgres-password");
if (!existsSync(adminFile)) writeFileSync(adminFile, secret(), { mode: 0o600 });

// Run one SQL statement as the admin. Returns the result as text.
const sql = (query: string) => run("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-tAc", query]);

async function ensureRunning(log: (l: string) => void) {
  const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER]).catch(() => "missing");
  if (state === "true") return;
  if (state === "missing") {
    log("→ Setting up the PostgreSQL server (first time only)…");
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
  for (let i = 0; i < 60; i++) {
    if (await run("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"]).then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The database server didn't start. Try deploying again.");
}

// Run SQL as the app's own user (over the local socket, which the image trusts).
// --csv gives us proper quoting; status lines like "UPDATE 3" come on their own.
async function asApp(app: string, query: string): Promise<{ out: string; cut: boolean }> {
  if (query.trimStart().startsWith("\\")) throw new Error("psql commands (starting with \\) aren't supported here. Use SQL.");
  const n = dbName(app);
  return capture(["exec", CONTAINER, "psql", "-U", n, "-d", n, "-X", "-v", "ON_ERROR_STOP=1", "--csv", "-c", query]);
}

// psql's CSV → columns and rows. An empty, unquoted field is NULL; "" is an empty string.
export function parseCsv(text: string): Result {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [], field = "", quoted = false, inQuotes = false;
  const push = () => { row.push(field === "" && !quoted ? null : field); field = ""; quoted = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') { inQuotes = true; quoted = true; }
    else if (ch === ",") push();
    else if (ch === "\n") { push(); rows.push(row); row = []; }
    else if (ch !== "\r") field += ch;
  }
  if (field || quoted || row.length) { push(); rows.push(row); }
  const [head = [], ...body] = rows;
  return { columns: head.map((c) => c ?? ""), rows: body };
}

// A status line instead of rows: "UPDATE 3", "CREATE TABLE"…
const STATUS = /^(INSERT \d+ |UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|COMMENT|SET|DO|COPY|VACUUM|ANALYZE|REINDEX|CALL)\b/;

// "public.users" or "users" → "public"."users"
const quote = (table: string) => table.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".");
// Our names for tables: "users" for the public schema, "other.users" otherwise.
const TABLES_SQL = `SELECT CASE WHEN t.table_schema = 'public' THEN t.table_name ELSE t.table_schema || '.' || t.table_name END AS name,
  s.n_live_tup AS rows FROM information_schema.tables t
  LEFT JOIN pg_stat_user_tables s ON s.schemaname = t.table_schema AND s.relname = t.table_name
  WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema') AND t.table_type IN ('BASE TABLE', 'VIEW')
  ORDER BY 1`;

export const postgres: Engine = {
  label: "PostgreSQL",
  container: CONTAINER,

  async provision(app, log) {
    await ensureRunning(log);
    const name = dbName(app);
    if (getEnv(app).DATABASE_URL && (await sql(`SELECT 1 FROM pg_database WHERE datname='${name}'`))) return;
    log("→ Creating your PostgreSQL database…");
    const password = secret();
    const roleExists = await sql(`SELECT 1 FROM pg_roles WHERE rolname='${name}'`);
    await sql(roleExists ? `ALTER ROLE ${name} PASSWORD '${password}'` : `CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
    if (!(await sql(`SELECT 1 FROM pg_database WHERE datname='${name}'`))) await sql(`CREATE DATABASE ${name} OWNER ${name}`);
    setEnv(app, "DATABASE_URL", `postgres://${name}:${password}@${CONTAINER}:5432/${name}`);
  },

  // Rename the database and user. Gives it a fresh password.
  async rename(oldApp, newApp) {
    const from = dbName(oldApp), to = dbName(newApp);
    await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${from}'`);
    await sql(`ALTER DATABASE ${from} RENAME TO ${to}`);
    await sql(`ALTER ROLE ${from} RENAME TO ${to}`);
    const password = secret();
    await sql(`ALTER ROLE ${to} PASSWORD '${password}'`);
    setEnv(newApp, "DATABASE_URL", `postgres://${to}:${password}@${CONTAINER}:5432/${to}`);
  },

  async destroy(app) {
    const name = dbName(app);
    await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${name}'`).catch(() => {});
    await sql(`DROP DATABASE IF EXISTS ${name}`);
    await sql(`DROP ROLE IF EXISTS ${name}`);
    deleteEnv(app, "DATABASE_URL");
  },

  async tables(app) {
    const r = parseCsv((await asApp(app, TABLES_SQL)).out);
    return r.rows.map(([name, rows]) => ({ name: name ?? "", rows: rows === null ? null : Number(rows) }));
  },

  async columns(app, table) {
    const [schema, name] = table.includes(".") ? table.split(".") : ["public", table];
    const esc = (s: string) => s.replace(/'/g, "''");
    const r = parseCsv((await asApp(app, `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
      EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints tc
        ON tc.constraint_name = k.constraint_name AND tc.table_schema = k.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name) AS pk
      FROM information_schema.columns c WHERE c.table_schema = '${esc(schema)}' AND c.table_name = '${esc(name)}' ORDER BY c.ordinal_position`)).out);
    return r.rows.map(([n, type, nullable, def, pk]) => ({ name: n ?? "", type: type ?? "", nullable: nullable === "YES", default: def, key: pk === "t" }));
  },

  async browse(app, table, offset, limit) {
    return this.query(app, `SELECT * FROM ${quote(table)} LIMIT ${limit} OFFSET ${offset}`, limit);
  },

  async query(app, query, maxRows) {
    const { out, cut } = await asApp(app, query);
    const text = out.trimEnd();
    if (!text) return { columns: [], rows: [], message: "Done." };
    if (!text.includes("\n") && STATUS.test(text)) return { columns: [], rows: [], message: text };
    const r = parseCsv(text + "\n");
    if (cut) r.rows.pop(); // the last row may be half
    const truncated = cut || r.rows.length > maxRows;
    return { ...r, rows: r.rows.slice(0, maxRows), truncated };
  },

  async size(app) {
    const n = Number(await sql(`SELECT pg_database_size('${dbName(app)}')`).catch(() => ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  },

  async dump(app, dir) {
    await pipeFile(["exec", CONTAINER, "pg_dump", "-U", "postgres", "-Fc", dbName(app)], { out: join(dir, "database.dump") });
    return true;
  },

  async restore(app, dir) {
    const n = dbName(app);
    await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${n}'`);
    await pipeFile(["exec", "-i", CONTAINER, "pg_restore", "-U", "postgres", "--clean", "--if-exists",
      "--no-owner", `--role=${n}`, "-d", n], { in: join(dir, "database.dump") });
  },
};
