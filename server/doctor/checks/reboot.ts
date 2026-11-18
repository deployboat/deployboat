// Some updates (like a new kernel) need a restart. Fix: restart the server.
import { existsSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const reboot: Check = {
  id: "reboot",
  title: "Restart needed",
  async check() {
    if (!existsSync("/var/run/reboot-required")) return { status: "ok", message: "No restart needed." };
    return { status: "warn", message: "Updates were installed that need a server restart.", detail: "Pick a quiet moment. Sites are offline for 1–2 minutes." };
  },
  fix: {
    label: "Restart server",
    describe: async () => "Restart the whole server in 5 seconds.\nAll sites go offline for about 1–2 minutes and come back by themselves.\nThis page will reconnect when it's back.",
    async run(log) {
      log("Restarting in 5 seconds…");
      await sh("systemd-run --on-active=5 /bin/systemctl reboot");
    },
  },
};
