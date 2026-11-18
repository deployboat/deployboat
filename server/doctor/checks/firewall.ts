// Firewall: only SSH, web and HTTPS open to the internet.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

// Only Caddy's network may reach Deploy Boat (port 3000). Apps live on their own networks.
const serviceSubnet = () => sh("docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' deployboat");

export const firewall: Check = {
  id: "firewall",
  title: "Firewall",
  async check() {
    const out = await sh("ufw status").catch(() => "");
    if (!/Status: active/.test(out)) return { status: "bad", message: "The firewall is off.", detail: "Anything running on the server can be reached from the internet." };
    const missing = ["22/tcp", "80/tcp", "443/tcp"].filter((p) => !out.includes(p));
    if (missing.length) return { status: "warn", message: `Firewall is on, but ${missing.join(", ")} isn't allowed.`, detail: "Sites or SSH may not be reachable." };
    if (/3000\/tcp.*172\.16\.0\.0\/12/.test(out) || !out.includes(await serviceSubnet().catch(() => "?")))
      return { status: "warn", message: "Apps can reach the Deploy Boat API port.", detail: "Only the web server should. One click narrows the rule." };
    return { status: "ok", message: "On. Only SSH, web and HTTPS are open." };
  },
  fix: {
    label: "Set up firewall",
    describe: async () => "Allow SSH (22), web (80) and HTTPS (443), let only the web server reach Deploy Boat, and turn the firewall on.\nNothing else will be reachable from the internet.",
    async run(log) {
      await sh("command -v ufw >/dev/null || apt-get install -y -qq ufw");
      await sh("ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp");
      await sh(`ufw allow from ${await serviceSubnet()} to any port 3000 proto tcp`);
      await sh("ufw delete allow from 172.16.0.0/12 to any port 3000 proto tcp >/dev/null 2>&1 || true");
      await sh("ufw --force enable");
      log("Firewall is on.");
    },
  },
};
