// HTTPS certificates for the dashboard, every app and every connected domain.
import tls from "node:tls";
import type { Check } from "../types.ts";
import { config } from "../../lib/config.ts";
import { db } from "../../lib/db.ts";
import { domainsOf, dnsReady } from "../../lib/domains.ts";
import { syncRoutes } from "../../deploy/route.ts";
import { sh } from "../sh.ts";

// Days until the certificate for `host` expires, or null if there isn't a valid one.
function daysLeft(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: "127.0.0.1", port: 443, servername: host, timeout: 5000 }, () => {
      const cert = sock.getPeerCertificate();
      const ok = sock.authorized && cert?.valid_to;
      sock.end();
      resolve(ok ? Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null);
    });
    sock.on("error", () => resolve(null));
    sock.on("timeout", () => { sock.destroy(); resolve(null); });
  });
}

async function hosts() {
  const apps = (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name);
  const custom = apps.flatMap(domainsOf);
  const connected = (await Promise.all(custom.map(async (h) => ((await dnsReady(h)) ? h : null)))).filter(Boolean) as string[];
  // Your own server domain counts once its DNS is right (until then the free nip.io ones are used).
  const own = config.baseDomain !== config.nipDomain && (await dnsReady(config.dashboardHost));
  const base = own ? config.baseDomain : config.nipDomain;
  return [...new Set([config.nipDashboard, ...(own ? [config.dashboardHost] : []), ...apps.map((a) => `${a}.${base}`), ...connected])];
}

export const https: Check = {
  id: "https",
  title: "HTTPS certificates",
  async check() {
    const list = await hosts();
    const results = await Promise.all(list.map(async (h) => ({ h, days: await daysLeft(h) })));
    const broken = results.filter((r) => r.days === null).map((r) => r.h);
    const soon = results.filter((r) => r.days !== null && r.days < 14).map((r) => r.h);
    if (broken.length) return { status: "bad", message: `No valid certificate for ${broken.length} address${broken.length === 1 ? "" : "es"}.`, detail: broken.join(", ") };
    if (soon.length) return { status: "warn", message: `Certificates expire soon for: ${soon.join(", ")}.`, detail: "They normally renew by themselves." };
    return { status: "ok", message: `All ${list.length} addresses have valid certificates.` };
  },
  fix: {
    label: "Retry certificates",
    describe: async () => "Reload the web server so it asks for certificates again.\nSites stay online. New certificates can take a minute.",
    async run(log) {
      await syncRoutes();
      await sh("docker restart caddy >/dev/null");
      log("Web server restarted. Check again in a minute.");
    },
  },
};
