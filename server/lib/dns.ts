// Checks a domain's DNS the way the rest of the internet sees it, and says in plain words
// what to change when it's wrong. Used for app domains, the dashboard domain and the
// server-wide domain (*.example.com).
import { Resolver } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";

// Ask public DNS, not the server's own cache, so fixes show up as soon as possible.
const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

export type Problem = { title: string; fix: string };
export type DnsCheck = {
  host: string;
  ok: boolean;
  record: { type: "A"; name: string; value: string }; // the record that should exist
  zone: string | null; // the domain as your DNS provider knows it
  found: string[]; // where it points now
  problems: Problem[];
};

// Cloudflare's proxy addresses (orange cloud). https://www.cloudflare.com/ips-v4
const CLOUDFLARE = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15",
  "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];

const toNum = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const inRange = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  return Math.floor(toNum(ip) / size) === Math.floor(toNum(base) / size);
};
const isCloudflare = (ip: string) => CLOUDFLARE.some((c) => inRange(ip, c));

const tryIt = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

// The zone is the part your DNS provider shows (example.com, or example.co.uk).
// Walk up from the full name until something answers with an SOA record.
async function findZone(host: string) {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    if (await tryIt(resolver.resolveSoa(name))) return name;
  }
  return null;
}

// A CAA record can allow only some certificate companies. We use Let's Encrypt (and ZeroSSL as backup).
async function caaBlocks(host: string) {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const caa = await tryIt(resolver.resolveCaa(labels.slice(i).join(".")));
    if (!caa?.length) continue;
    const issuers = caa.filter((r) => r.issue !== undefined).map((r) => String(r.issue).toLowerCase());
    if (!issuers.length) return false;
    return !issuers.some((v) => v.includes("letsencrypt.org") || v.includes("zerossl.com"));
  }
  return false;
}

// Check one address. With `wildcard`, check *.host (every name under it) instead.
export async function checkDns(host: string, { wildcard = false } = {}): Promise<DnsCheck> {
  const ip = config.publicIp;
  const probe = wildcard ? `check-${randomBytes(4).toString("hex")}.${host}` : host;
  const shown = wildcard ? `*.${host}` : host;
  const zone = await findZone(host);
  const rel = zone && host !== zone ? host.slice(0, -(zone.length + 1)) : "";
  const name = wildcard ? (rel ? `*.${rel}` : "*") : rel || "@";
  const record = { type: "A" as const, name, value: ip };
  const problems: Problem[] = [];
  const result = (found: string[]) => ({ host: shown, ok: !problems.length, record, zone, found, problems });

  if (!zone) {
    problems.push({
      title: `${host} isn't on the internet yet.`,
      fix: "Check the spelling. If you just bought it, it can take up to an hour before it shows up. "
        + "Make sure the domain uses your registrar's (or Cloudflare's) nameservers.",
    });
    return result([]);
  }

  const [a, aaaa, cname] = await Promise.all([
    tryIt(resolver.resolve4(probe)), tryIt(resolver.resolve6(probe)), tryIt(resolver.resolveCname(probe)),
  ]);
  const found = a ?? [];
  const where = `In your DNS settings for ${zone}`;
  const add = `add an A record with name ${name} and value ${ip}`;

  if (!found.length) {
    problems.push({
      title: wildcard ? `Names under ${host} don't point anywhere yet.` : `${host} doesn't point anywhere yet.`,
      fix: `${where}, ${add}.${wildcard ? " The * means every name under it, so each app gets its address without more setup." : ""}`,
    });
  } else if (found.some(isCloudflare)) {
    problems.push({
      title: "Cloudflare's proxy is on (orange cloud).",
      fix: `In Cloudflare, open DNS, edit the ${name} record and switch it to "DNS only" (grey cloud). `
        + "Deploy Boat sets up HTTPS itself and needs visitors to reach the server directly.",
    });
  } else if (!found.includes(ip)) {
    problems.push({
      title: `Points to ${found.join(", ")}, not to this server.`,
      fix: cname?.length
        ? `${shown} is a CNAME to ${cname[0]}. ${where}, delete that CNAME and ${add}.`
        : `${where}, change the ${name} A record's value to ${ip}.`,
    });
  } else if (found.length > 1) {
    const others = found.filter((x) => x !== ip);
    problems.push({
      title: `Also points to ${others.join(", ")}.`,
      fix: `${where}, delete the ${name} A record${others.length > 1 ? "s" : ""} with ${others.join(", ")}. Otherwise some visitors land on the other server.`,
    });
  }

  // IPv6: visitors' browsers prefer it, so a wrong one breaks the site for many people.
  const ip6 = process.env.PUBLIC_IP6;
  const bad6 = (aaaa ?? []).filter((x) => x !== ip6);
  if (bad6.length && !found.some(isCloudflare)) {
    problems.push({
      title: `Has an IPv6 (AAAA) record: ${bad6.join(", ")}.`,
      fix: `${where}, delete the AAAA record for ${name}. Deploy Boat uses this server's IPv4 address, and many visitors' browsers would try the IPv6 one first.`,
    });
  }

  if (await caaBlocks(host)) {
    problems.push({
      title: "A CAA record blocks free HTTPS certificates.",
      fix: `${where}, add a CAA record: name @, flags 0, tag issue, value letsencrypt.org. Or delete the existing CAA records.`,
    });
  }

  return result(found);
}

// Domain names people type: "https://Shop.com/" → "shop.com".
export const cleanHost = (raw: unknown) =>
  String(raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, "");

export const looksLikeHost = (h: string) => /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(h);
