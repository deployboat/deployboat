// Clock sync. A wrong clock breaks HTTPS and makes logs confusing.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const time: Check = {
  id: "time",
  title: "Clock",
  async check() {
    const synced = (await sh("timedatectl show -p NTPSynchronized --value").catch(() => "")) === "yes";
    return synced ? { status: "ok", message: "The clock is in sync." } : { status: "warn", message: "The clock isn't being synced.", detail: "HTTPS and cron jobs depend on the right time." };
  },
  fix: {
    label: "Turn on time sync",
    describe: async () => "Turn on automatic time sync (systemd-timesyncd).",
    async run(log) {
      await sh("timedatectl set-ntp true");
      log("Time sync is on. It can take a minute to show as synced.");
    },
  },
};
