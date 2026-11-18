// The firewall should block everything coming in that isn't explicitly allowed.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const firewallPolicy: Check = {
  id: "firewallpolicy",
  title: "Firewall default",
  async check() {
    const out = await sh("ufw status verbose").catch(() => "");
    if (!/Status: active/.test(out)) return { status: "info", message: "The firewall is off (see the Firewall check)." };
    const incoming = out.match(/Default: (\w+) \(incoming\)/)?.[1];
    if (incoming === "deny" || incoming === "reject") return { status: "ok", message: "Anything not allowed is blocked." };
    return { status: "bad", message: `Incoming traffic is ${incoming ?? "not blocked"} by default.`, detail: "Every program listening on this server can be reached from the internet." };
  },
  fix: {
    label: "Block by default",
    describe: async () => "Block all incoming traffic that isn't allowed (SSH, web and HTTPS stay open).\nOutgoing traffic stays allowed.",
    async run(log) {
      await sh("ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp");
      await sh("ufw default deny incoming && ufw default allow outgoing && ufw --force enable");
      log("Incoming traffic is now blocked unless allowed.");
    },
  },
};
