// Is there a newer Deploy Boat? The version logic lives in lib/version.ts.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";
import { versionInfo, REPO } from "../../lib/version.ts";

export const version: Check = {
  id: "version",
  title: "Deploy Boat version",
  async check() {
    const v = await versionInfo();
    if (!v.update) return { status: "ok", message: `You're on the latest version (${v.current}).` };
    return v.edge
      ? { status: "info", message: `An update is available (${v.update}).` }
      : { status: "info", message: `Deploy Boat ${v.update} is available. You have ${v.current}.`, link: v.notes ?? undefined };
  },
  fix: {
    label: "Update now",
    describe: async () => "Download the newest Deploy Boat and restart it.\nYour apps keep running. The dashboard is unavailable for a few seconds.",
    async run(log) {
      log("Updating… the dashboard will reconnect in a moment.");
      // Runs outside our own service, because the installer restarts Deploy Boat.
      // The installer picks the newest release (or main, on an edge server).
      await sh(`systemd-run --unit=deployboat-update-$(date +%s) bash ${REPO}/install.sh`);
    },
  },
};
