// Domains.
//  - Server domain: where apps live. *.example.com gives every app <name>.example.com,
//    and the dashboard deployboat.example.com. Without one, the free <ip>.nip.io is used.
//  - Dashboard domain: optional, its own address for the dashboard (e.g. panel.mysite.com).
//  - App domains: myshop.com → an app.
// The free nip.io addresses always keep working, so a DNS mistake never locks you out.
import { db } from "./db.ts";
import { config } from "./config.ts";
import { getSetting, setSetting } from "./settings.ts";
import { checkDns } from "./dns.ts";

db.exec("CREATE TABLE IF NOT EXISTS domains (host TEXT PRIMARY KEY, app TEXT NOT NULL)");

// --- server + dashboard domain -----------------------------------------------------

type ServerDomain = { base: string; dashboard: string };
const envBase = process.env.BASE_DOMAIN || "";

export const serverDomain = () => getSetting<ServerDomain>("domain", { base: envBase, dashboard: "" });

function apply() {
  const d = serverDomain();
  config.baseDomain = d.base || config.nipDomain;
  config.dashboardHost = d.dashboard || `deployboat.${config.baseDomain}`;
}
apply();

export function saveServerDomain(d: ServerDomain) {
  setSetting("domain", d);
  apply();
}

// Every address the dashboard answers on (custom first).
export const dashboardHosts = () => [...new Set([config.dashboardHost, config.nipDashboard])];

// An app's own free addresses: <name>.<your domain> and <name>.<ip>.nip.io.
export const appHosts = (app: string) => [...new Set([`${app}.${config.baseDomain}`, `${app}.${config.nipDomain}`])];

// --- app domains -----------------------------------------------------------------

export const domainsOf = (app: string) =>
  (db.prepare("SELECT host FROM domains WHERE app = ? ORDER BY host").all(app) as { host: string }[]).map((r) => r.host);

export const domainOwner = (host: string) =>
  (db.prepare("SELECT app FROM domains WHERE host = ?").get(host) as { app: string } | undefined)?.app;

export const addDomain = (app: string, host: string) => db.prepare("INSERT INTO domains (host, app) VALUES (?, ?)").run(host, app);
export const removeDomain = (app: string, host: string) => db.prepare("DELETE FROM domains WHERE app = ? AND host = ?").run(app, host);

// Why a name can't be used, or null if it's fine.
export function hostTaken(host: string) {
  if (host.endsWith(".nip.io")) return "nip.io addresses are already free for every app.";
  if (host.endsWith(`.${config.baseDomain}`)) return `Names under ${config.baseDomain} already belong to apps. Change the app's address on its Domains page instead.`;
  if (dashboardHosts().includes(host)) return "That's the dashboard's address.";
  return null;
}

// Does the domain point to this server? (Quick yes/no, for Server Doctor.)
export async function dnsReady(host: string) {
  return (await checkDns(host)).ok;
}
