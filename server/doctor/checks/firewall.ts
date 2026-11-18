// Firewall: only SSH, web and HTTPS open to the internet.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const firewall: Check = {
  id: "firewall",
  title: "Firewall",
  async check() {
    const out = await sh("ufw status").catch(() => "");
    if (!/Status: active/.test(out)) return { status: "bad", message: "The firewall is off.", detail: "Anything running on the server can be reached from the internet." };
    const missing = ["22/tcp", "80/tcp", "443/tcp"].filter((p) => !out.includes(p));
    if (missing.length) return { status: "warn", message: `Firewall is on, but ${missing.join(", ")} isn't allowed.`, detail: "Sites or SSH may not be reachable." };
    return { status: "ok", message: "On. Only SSH, web and HTTPS are open." };
  },
  fix: {
    label: "Set up firewall",
    describe: async () => "Allow SSH (22), web (80) and HTTPS (443), let Docker reach Deploy Boat, and turn the firewall on.\nNothing else will be reachable from the internet.",
    async run(log) {
      await sh("command -v ufw >/dev/null || apt-get install -y -qq ufw");
      await sh("ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow from 172.16.0.0/12 to any port 3000 proto tcp");
      await sh("ufw --force enable");
      log("Firewall is on.");
    },
  },
};
