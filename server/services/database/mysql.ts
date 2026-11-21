// MySQL (MariaDB, a drop-in MySQL): one shared server, one database + user per app.
// The app gets DATABASE_URL (mysql://app_shop:…@mysql:3306/app_shop).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../lib/config.ts";
import { getEnv, setEnv, deleteEnv } from "../../lib/env.ts";
import { run } from "../../lib/shell.ts";
import { capture, pipeFile } from "./exec.ts";
import type { Engine, Result } from "./types.ts";

const CONTAINER = "mysql";
const IMAGE = "mariadb:11";
const secret = () => randomBytes(16).toString("hex");
const dbName = (app: string) => "app_" + app.replace(/-/g, "_");

// Root password, created once.
const rootFile = join(config.dataDir, "mysql-password");
const rootPassword = () => {
  if (!existsSync(rootFile)) writeFileSync(rootFile, secret(), { mode: 0o600 });
  return readFileSync(rootFile, "utf8").trim();
};

// Run SQL as root. The password goes in an environment variable, not the command line.
const root = (query: string, db?: string) =>
  run("docker", ["exec", "-e", `MYSQL_PWD=${rootPassword()}`, CONTAINER, "mariadb", "-uroot", "-N", "-B", ...(db ? ["-D", db] : []), "-e", query]);

async function ensureRunning(log: (l: string) => void) {
  const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER]).catch(() => "missing");
  if (state === "true") return;
  if (state === "missing") {
    log("→ Setting up the MySQL server (first time only)…");
    await run("docker", [
      "run", "-d",
      "--name", CONTAINER,
      "--network", config.dockerNetwork,
      "--restart", "unless-stopped",
      "-e", `MARIADB_ROOT_PASSWORD=${rootPassword()}`,
      "-v", `${join(config.dataDir, "mysql")}:/var/lib/mysql`,
      IMAGE,
    ]);
  } else {
    await run("docker", ["start", CONTAINER]);
  }
  for (let i = 0; i < 90; i++) {
    if (await root("SELECT 1").then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The MySQL server didn't start. Try deploying again.");
}

// The app's own password, from its DATABASE_URL.
const appPassword = (app: string) => decodeURIComponent(new URL(getEnv(app).DATABASE_URL).password);

// Run SQL as the app's own user. --xml tells NULL apart from the text "NULL".
async function asApp(app: string, query: string) {
  const n = dbName(app);
  return capture(["exec", "-e", `MYSQL_PWD=${appPassword(app)}`, CONTAINER, "mariadb", `-u${n}`, "-h127.0.0.1", "-D", n, "--xml", "-e", query]);
}

const unXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

// <resultset><row><field name="id">1</field><field name="x" xsi:nil="true" /></row></resultset>
export function parseXml(xml: string): Result {
  const sets = [...xml.matchAll(/<resultset[^>]*>([\s\S]*?)<\/resultset>/g)];
  const last = sets.at(-1)?.[1] ?? ""; // with several statements, show the last result
  const columns: string[] = [];
  const rows = [...last.matchAll(/<row>([\s\S]*?)<\/row>/g)].map((r, i) =>
    [...r[1].matchAll(/<field name="([^"]*)"(?:\s+xsi:nil="true"\s*\/>|\s*\/>|>([\s\S]*?)<\/field>)/g)].map((f) => {
      if (i === 0) columns.push(unXml(f[1]));
      return f[0].includes('xsi:nil="true"') ? null : unXml(f[2] ?? "");
    }));
  return { columns, rows };
}

const quote = (table: string) => "`" + table.replace(/`/g, "``") + "`";

export const mysql: Engine = {
  label: "MySQL",
  container: CONTAINER,

  async provision(app, log) {
    await ensureRunning(log);
    const n = dbName(app);
    if (getEnv(app).DATABASE_URL && (await root(`SHOW DATABASES LIKE '${n}'`))) return;
    log("→ Creating your MySQL database…");
    const password = secret();
    await root(`CREATE DATABASE IF NOT EXISTS \`${n}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      CREATE USER IF NOT EXISTS '${n}'@'%' IDENTIFIED BY '${password}';
      ALTER USER '${n}'@'%' IDENTIFIED BY '${password}';
      GRANT ALL PRIVILEGES ON \`${n}\`.* TO '${n}'@'%';`);
    setEnv(app, "DATABASE_URL", `mysql://${n}:${password}@${CONTAINER}:3306/${n}`);
  },

  // MySQL can't rename a database: make the new one, move every table, drop the old one.
  async rename(oldApp, newApp) {
    const from = dbName(oldApp), to = dbName(newApp);
    await root(`CREATE DATABASE IF NOT EXISTS \`${to}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const tables = (await root(`SHOW TABLES`, from)).split("\n").filter(Boolean);
    if (tables.length) await root(`RENAME TABLE ${tables.map((t) => `\`${from}\`.${quote(t)} TO \`${to}\`.${quote(t)}`).join(", ")}`);
    await root(`DROP DATABASE IF EXISTS \`${from}\`; RENAME USER '${from}'@'%' TO '${to}'@'%'`);
    const password = secret();
    await root(`ALTER USER '${to}'@'%' IDENTIFIED BY '${password}'; GRANT ALL PRIVILEGES ON \`${to}\`.* TO '${to}'@'%'`);
    setEnv(newApp, "DATABASE_URL", `mysql://${to}:${password}@${CONTAINER}:3306/${to}`);
  },

  async destroy(app) {
    const n = dbName(app);
    await root(`DROP DATABASE IF EXISTS \`${n}\`; DROP USER IF EXISTS '${n}'@'%'`);
    deleteEnv(app, "DATABASE_URL");
  },

  async tables(app) {
    const r = parseXml((await asApp(app, `SELECT table_name AS name, table_rows AS \`rows\` FROM information_schema.tables
      WHERE table_schema = DATABASE() ORDER BY table_name`)).out);
    return r.rows.map(([name, rows]) => ({ name: name ?? "", rows: rows === null ? null : Number(rows) }));
  },

  async columns(app, table) {
    const r = parseXml((await asApp(app, `SELECT column_name, column_type, is_nullable, column_default, column_key
      FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table.replace(/'/g, "''")}' ORDER BY ordinal_position`)).out);
    return r.rows.map(([n, type, nullable, def, key]) => ({ name: n ?? "", type: type ?? "", nullable: nullable === "YES", default: def, key: key === "PRI" }));
  },

  async browse(app, table, offset, limit) {
    return this.query(app, `SELECT * FROM ${quote(table)} LIMIT ${limit} OFFSET ${offset}`, limit);
  },

  async query(app, query, maxRows) {
    const { out, cut } = await asApp(app, query);
    if (!/<resultset/.test(out)) return { columns: [], rows: [], message: "Done." };
    const r = parseXml(out);
    if (!r.columns.length && !r.rows.length) {
      const changed = /^\s*(insert|update|delete|replace)\b/i.test(query);
      return { columns: [], rows: [], message: changed ? "Done." : "No rows." };
    }
    return { ...r, rows: r.rows.slice(0, maxRows), truncated: cut || r.rows.length > maxRows };
  },

  async size(app) {
    const n = Number(await root(`SELECT SUM(data_length + index_length) FROM information_schema.tables WHERE table_schema = '${dbName(app)}'`).catch(() => ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  },

  async dump(app, dir) {
    await pipeFile(["exec", "-e", `MYSQL_PWD=${rootPassword()}`, CONTAINER, "mariadb-dump", "-uroot",
      "--single-transaction", "--routines", "--triggers", dbName(app)], { out: join(dir, "database.sql") });
    return true;
  },

  // Start from an empty database, so tables made after the backup are gone too.
  async restore(app, dir) {
    const n = dbName(app);
    await root(`DROP DATABASE IF EXISTS \`${n}\`; CREATE DATABASE \`${n}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      GRANT ALL PRIVILEGES ON \`${n}\`.* TO '${n}'@'%'`);
    await pipeFile(["exec", "-i", "-e", `MYSQL_PWD=${rootPassword()}`, CONTAINER, "mariadb", "-uroot", n], { in: join(dir, "database.sql") });
  },
};
