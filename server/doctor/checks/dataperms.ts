// Deploy Boat's data folder holds app secrets: only root may look inside.
import { chmodSync, statSync } from "node:fs";
import type { Check } from "../types.ts";
import { config } from "../../lib/config.ts";

const mode = () => statSync(config.dataDir).mode & 0o777;

export const dataPerms: Check = {
  id: "dataperms",
  title: "Data folder",
  async check() {
    const m = mode();
    if (m & 0o077) return { status: "bad", message: `Other users can look inside ${config.dataDir} (permissions ${m.toString(8)}).`, detail: "It holds app secrets, passwords and deploy keys." };
    return { status: "ok", message: "Only root can read Deploy Boat's data." };
  },
  fix: {
    label: "Lock it",
    describe: async () => `Make ${config.dataDir} readable by root only (permissions 700). Apps keep working.`,
    async run(log) { chmodSync(config.dataDir, 0o700); log("Done."); },
  },
};
