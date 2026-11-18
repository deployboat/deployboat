// fail2ban blocks IPs that keep guessing SSH passwords.
import type { Check } from "../types.ts";
import { sh, shOk } from "../sh.ts";

export const fail2ban: Check = {
  id: "fail2ban",
  title: "Brute-force protection",
  async check() {
    if (await shOk("systemctl is-active --quiet fail2ban")) return { status: "ok", message: "fail2ban is running." };
    return { status: "warn", message: "fail2ban isn't running.", detail: "It blocks bots that try to guess your SSH password." };
  },
  fix: {
    label: "Turn it on",
    describe: async () => "Install fail2ban if needed and start it now and on every boot.",
    async run(log) {
      await sh("command -v fail2ban-server >/dev/null || apt-get install -y -qq fail2ban");
      await sh("systemctl enable --now fail2ban");
      log("fail2ban is running.");
    },
  },
};
