// Your own domains (server, dashboard and app domains): do they still point here?
import type { Check } from "../types.ts";
import { db } from "../../lib/db.ts";
import { config } from "../../lib/config.ts";
import { serverDomain } from "../../lib/domains.ts";
import { checkDns, type DnsCheck } from "../../lib/dns.ts";

export const domains: Check = {
  id: "domains",
  title: "Custom domains",
  async check() {
    const rows = db.prepare("SELECT host, app FROM domains").all() as { host: string; app: string }[];
    const d = serverDomain();
    const checks: { dns: DnsCheck; link: string }[] = await Promise.all([
      ...(d.base ? [checkDns(d.base, { wildcard: true }).then((dns) => ({ dns, link: "#/settings" }))] : []),
      ...(d.dashboard ? [checkDns(d.dashboard).then((dns) => ({ dns, link: "#/settings" }))] : []),
      ...rows.map((r) => checkDns(r.host).then((dns) => ({ dns, link: `#/apps/${encodeURIComponent(r.app)}/domains` }))),
    ]);
    if (!checks.length) return { status: "ok", message: "No custom domains." };
    const off = checks.filter((c) => !c.dns.ok);
    if (!off.length) return { status: "ok", message: `All ${checks.length} domain${checks.length === 1 ? "" : "s"} point here.` };
    const first = off[0].dns;
    return {
      status: "warn",
      message: `DNS needs a fix: ${off.map((c) => c.dns.host).join(", ")}.`,
      detail: `${first.host}: ${first.problems[0].title} ${first.problems[0].fix}`
        + (off.length > 1 ? `\nThe others are explained on their Domains page.` : "")
        + `\nThe free address (…${config.nipDomain}) keeps working meanwhile.`,
      link: off[0].link,
    };
  },
};
