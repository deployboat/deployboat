// The "database" service. Each app picks one type when it adds a database:
//   postgres  PostgreSQL, a shared server (postgres.ts). The default.
//   mysql     MySQL (MariaDB), a shared server (mysql.ts)
//   sqlite    a file in the app's /data folder, no server (sqlite.ts)
// The choice is saved per app ("db:<app>" in settings). Apps from before this choice
// existed have no setting, and they're PostgreSQL.
import { getEnv } from "../../lib/env.ts";
import { getSetting, setSetting, deleteSetting } from "../../lib/settings.ts";
import { postgres } from "./postgres.ts";
import { mysql } from "./mysql.ts";
import { sqlite } from "./sqlite.ts";
import type { Engine } from "./types.ts";

export const ENGINES = { postgres, mysql, sqlite } satisfies Record<string, Engine>;
export type DbType = keyof typeof ENGINES;
export const isDbType = (t: unknown): t is DbType => typeof t === "string" && t in ENGINES;

export const typeOf = (app: string): DbType => {
  const t = getSetting<{ type: string }>(`db:${app}`, { type: "postgres" }).type;
  return isDbType(t) ? t : "postgres";
};
export const engineOf = (app: string) => ENGINES[typeOf(app)];

// Has this app added a database?
export const enabled = (app: string) => !!getEnv(app).DATABASE_URL;

// Pick the type for an app that doesn't have a database yet. (Can't switch a live one:
// remove it first. Moving data between types is a job for the app's own tools.)
export function chooseType(app: string, type: DbType) {
  if (enabled(app) && typeOf(app) !== type) throw new Error(`This app already has a ${engineOf(app).label} database. Delete it first to pick another type.`);
  if (type === "postgres") deleteSetting(`db:${app}`); else setSetting(`db:${app}`, { type });
}

// --- the service interface (see services/index.ts) ---------------------------------

export const provision = (app: string, log: (l: string) => void) => engineOf(app).provision(app, log);

export async function rename(oldApp: string, newApp: string) {
  const type = typeOf(oldApp);
  if (type !== "postgres") { setSetting(`db:${newApp}`, { type }); deleteSetting(`db:${oldApp}`); }
  if (getEnv(newApp).DATABASE_URL) await ENGINES[type].rename(oldApp, newApp);
}

export async function destroy(app: string) {
  if (!enabled(app)) return;
  await engineOf(app).destroy(app);
  deleteSetting(`db:${app}`);
}
