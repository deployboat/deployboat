// Is there a newer Deploy Boat? Checked at most once an hour.
//
// Most servers run releases (git tags like v0.5.0): we compare with the newest release.
// Servers installed with --edge follow main: we count the new commits on main.
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";
import { config } from "../../lib/config.ts";

const REPO = resolve(process.cwd(), ".."); // server/ runs from inside the repo
const isEdge = () => existsSync(`${config.dataDir}/channel`) && readFileSync(`${config.dataDir}/channel`, "utf8").trim() === "edge";

type Status = { newer: string | null; current: string };
let cache: { at: number; status: Status } = { at: 0, status: { newer: null, current: "" } };

// "v0.10.0" > "v0.9.2": compare the numbers one by one.
const newerThan = (a: string, b: string) => {
  const pa = a.replace(/^v/, "").split(".").map(Number), pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function status(): Promise<Status> {
  if (Date.now() - cache.at < 3600_000) return cache.status;
  let s: Status;
  if (isEdge()) {
    await sh(`git -C ${REPO} fetch -q origin main`).catch(() => {});
    const n = Number(await sh(`git -C ${REPO} rev-list --count HEAD..origin/main`).catch(() => "0")) || 0;
    s = { newer: n ? `${n} new change${n === 1 ? "" : "s"} on main` : null, current: "edge (main)" };
  } else {
    const current = (await sh(`git -C ${REPO} describe --tags --abbrev=0`).catch(() => "")).trim();
    const latest = (await sh(`git -C ${REPO} ls-remote --tags --refs --sort=-v:refname origin 'v*' | head -1 | sed 's#.*refs/tags/##'`).catch(() => "")).trim();
    s = { newer: latest && (!current || newerThan(latest, current)) ? latest : null, current: current || "unknown" };
  }
  cache = { at: Date.now(), status: s };
  return s;
}

export const version: Check = {
  id: "version",
  title: "Deploy Boat version",
  async check() {
    const s = await status();
    if (!s.newer) return { status: "ok", message: `You're on the latest version (${s.current}).` };
    return isEdge()
      ? { status: "info", message: `An update is available (${s.newer}).` }
      : { status: "info", message: `Deploy Boat ${s.newer} is available. You have ${s.current}.`,
          link: `https://github.com/deployboat/deployboat/releases/tag/${s.newer}` };
  },
  fix: {
    label: "Update now",
    describe: async () => "Download the newest Deploy Boat and restart it.\nYour apps keep running. The dashboard is unavailable for a few seconds.",
    async run(log) {
      log("Updating… the dashboard will reconnect in a moment.");
      cache.at = 0;
      // Runs outside our own service, because the installer restarts Deploy Boat.
      // The installer picks the newest release (or main, on an edge server).
      await sh(`systemd-run --unit=deployboat-update-$(date +%s) bash ${REPO}/install.sh`);
    },
  },
};
