// Is there a newer Deploy Boat? Checked at most once an hour.
import { resolve } from "node:path";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

const REPO = resolve(process.cwd(), ".."); // server/ runs from inside the repo
let cache = { at: 0, behind: 0 };

async function behind() {
  if (Date.now() - cache.at < 3600_000) return cache.behind;
  await sh(`git -C ${REPO} fetch -q origin main`).catch(() => {});
  const n = Number(await sh(`git -C ${REPO} rev-list --count HEAD..origin/main`).catch(() => "0")) || 0;
  cache = { at: Date.now(), behind: n };
  return n;
}

export const version: Check = {
  id: "version",
  title: "Deploy Boat version",
  async check() {
    const n = await behind();
    return n ? { status: "info", message: `An update is available (${n} new change${n === 1 ? "" : "s"}).` } : { status: "ok", message: "You're on the latest version." };
  },
  fix: {
    label: "Update now",
    describe: async () => "Download the latest Deploy Boat and restart it.\nYour apps keep running. The dashboard is unavailable for a few seconds.",
    async run(log) {
      log("Updating… the dashboard will reconnect in a moment.");
      cache.at = 0;
      // Runs outside our own service, because the installer restarts Deploy Boat.
      await sh(`systemd-run --unit=deployboat-update-$(date +%s) bash ${REPO}/install.sh`);
    },
  },
};
