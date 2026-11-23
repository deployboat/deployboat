// The steps of "Make your server private" that the server can check by itself.
// Each one answers: done or not, and a short sentence saying why.
import { resolveNs } from "node:dns/promises";
import { config } from "../../lib/config.ts";
import { db } from "../../lib/db.ts";
import { domainsOf, appHosts } from "../../lib/domains.ts";
import { getSetting } from "../../lib/settings.ts";
import { sh } from "../sh.ts";

export type StepResult = { ok: boolean; message: string };

// Tailscale is installed and logged in: it has a 100.x.y.z address.
async function tailscale(): Promise<StepResult> {
  const ip = (await sh("tailscale ip -4 2>/dev/null").catch(() => "")).split("\n")[0]?.trim();
  if (!ip) return { ok: false, message: "Tailscale isn't running on this server yet (no Tailscale address)." };
  return { ok: true, message: `Connected. This server's Tailscale address is ${ip}.` };
}

// The domain's nameservers are Cloudflare's. For apps.example.com we look at
// apps.example.com, then example.com, until we find nameservers.
async function cloudflareDns(): Promise<StepResult> {
  if (config.baseDomain === config.nipDomain) return { ok: false, message: "Set a domain of your own first (Settings → Domain). Free nip.io addresses can't use a tunnel." };
  const parts = config.baseDomain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const zone = parts.slice(i).join(".");
    const ns = await resolveNs(zone).catch(() => [] as string[]);
    if (!ns.length) continue;
    if (ns.every((n) => n.toLowerCase().endsWith(".ns.cloudflare.com"))) return { ok: true, message: `${zone} uses Cloudflare's nameservers.` };
    return { ok: false, message: `${zone} uses ${ns[0]}, not Cloudflare. Move the domain to Cloudflare first.` };
  }
  return { ok: false, message: `Couldn't find nameservers for ${config.baseDomain}.` };
}

// cloudflared is installed as a service and running.
async function cloudflared(): Promise<StepResult> {
  const state = (await sh("systemctl is-active cloudflared 2>/dev/null").catch((e) => String(e.message))).trim();
  if (state === "active") return { ok: true, message: "cloudflared is running and connected to Cloudflare." };
  return { ok: false, message: "cloudflared isn't running on this server yet." };
}

async function tunnelMode(): Promise<StepResult> {
  return getSetting("private", { tunnel: false }).tunnel
    ? { ok: true, message: "Deploy Boat is set up to work behind the tunnel." }
    : { ok: false, message: "Not turned on yet. Use the button above." };
}

// Every address answers through Cloudflare (it adds a "cf-ray" header to every reply).
async function viaCloudflare(host: string) {
  try {
    const r = await fetch(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return r.headers.has("cf-ray");
  } catch { return false; }
}
async function addresses(): Promise<StepResult> {
  const apps = (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name);
  const hosts = [...new Set([config.dashboardHost, ...apps.flatMap((a) => [...appHosts(a), ...domainsOf(a)])])]
    .filter((h) => !h.endsWith(config.nipDomain)); // nip.io addresses point at the IP; they stop working, that's fine
  const results = await Promise.all(hosts.map(async (h) => ({ h, ok: await viaCloudflare(h) })));
  const missing = results.filter((r) => !r.ok).map((r) => r.h);
  if (missing.length) return { ok: false, message: `Not going through the tunnel yet: ${missing.join(", ")}` };
  return { ok: true, message: `All ${hosts.length} address${hosts.length === 1 ? "" : "es"} go through Cloudflare.` };
}

export const CHECKS: Record<string, () => Promise<StepResult>> = {
  "tailscale-server": tailscale,
  "cf-domain": cloudflareDns,
  "cf-tunnel": cloudflared,
  "tunnel-mode": tunnelMode,
  "cf-addresses": addresses,
};
