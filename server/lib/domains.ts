// Custom domains (myshop.com → an app). The default <app>.<ip>.nip.io address always works too.
import { resolve4 } from "node:dns/promises";
import { db } from "./db.ts";
import { config } from "./config.ts";

db.exec("CREATE TABLE IF NOT EXISTS domains (host TEXT PRIMARY KEY, app TEXT NOT NULL)");

export const domainsOf = (app: string) =>
  (db.prepare("SELECT host FROM domains WHERE app = ? ORDER BY host").all(app) as { host: string }[]).map((r) => r.host);

export const domainOwner = (host: string) =>
  (db.prepare("SELECT app FROM domains WHERE host = ?").get(host) as { app: string } | undefined)?.app;

export const addDomain = (app: string, host: string) => db.prepare("INSERT INTO domains (host, app) VALUES (?, ?)").run(host, app);
export const removeDomain = (app: string, host: string) => db.prepare("DELETE FROM domains WHERE app = ? AND host = ?").run(app, host);

export const validHost = (h: string) =>
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) && !h.endsWith(config.baseDomain);

// Does the domain point to this server yet?
export async function dnsReady(host: string) {
  try { return (await resolve4(host)).includes(config.publicIp); } catch { return false; }
}
