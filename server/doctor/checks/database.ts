// The shared Postgres: does it answer, how full are its connections, how big is it.
import type { Check } from "../types.ts";
import { run } from "../../lib/shell.ts";

const sql = (q: string) => run("docker", ["exec", "postgres", "psql", "-U", "postgres", "-tAc", q]);

export const database: Check = {
  id: "database",
  title: "Database server",
  async check() {
    const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", "postgres"]).catch(() => "");
    if (!state) return { status: "ok", message: "No app uses a database yet." };
    if (state !== "true") return { status: "info", message: "The database server isn't running (see Built-in services)." };
    try {
      const [used, max] = (await sql("SELECT (SELECT count(*) FROM pg_stat_activity), current_setting('max_connections')")).split("|").map(Number);
      const size = await sql("SELECT pg_size_pretty(sum(pg_database_size(datname))) FROM pg_database");
      if (used / max >= 0.8) return { status: "warn", message: `${used} of ${max} database connections in use.`, detail: "An app may be leaking connections. New ones will be refused when it's full." };
      return { status: "ok", message: `Answering. ${used} of ${max} connections, ${size} in total.` };
    } catch {
      return { status: "bad", message: "The database server is running but doesn't answer.", detail: "Apps with a database will fail. Restart it on the System page." };
    }
  },
};
