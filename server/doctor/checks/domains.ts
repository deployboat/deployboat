// Custom domains that were connected but now point somewhere else.
import type { Check } from "../types.ts";
import { db } from "../../lib/db.ts";
import { dnsReady } from "../../lib/domains.ts";
import { config } from "../../lib/config.ts";

export const domains: Check = {
  id: "domains",
  title: "Custom domains",
  async check() {
    const rows = db.prepare("SELECT host, app FROM domains").all() as { host: string; app: string }[];
    if (!rows.length) return { status: "ok", message: "No custom domains." };
    const off = (await Promise.all(rows.map(async (r) => ((await dnsReady(r.host)) ? null : r)))).filter(Boolean) as typeof rows;
    if (!off.length) return { status: "ok", message: `All ${rows.length} custom domain${rows.length === 1 ? "" : "s"} point here.` };
    return { status: "warn", message: `Not pointing to this server: ${off.map((r) => r.host).join(", ")}.`,
      detail: `Their DNS A record should be ${config.publicIp}. Visitors won't reach your app until it is.`,
      link: `#/apps/${encodeURIComponent(off[0].app)}/domains` };
  },
};
