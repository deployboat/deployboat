// System updates. Fix: install them.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

async function pending() {
  const out = await sh("apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep '^Inst' || true");
  const lines = out.split("\n").filter(Boolean);
  return { all: lines.length, security: lines.filter((l) => /security/i.test(l)).length };
}

export const updates: Check = {
  id: "updates",
  title: "System updates",
  async check() {
    const p = await pending();
    if (p.security) return { status: "warn", message: `${p.security} security update${p.security === 1 ? "" : "s"} waiting.`, detail: "Automatic updates install these daily, but you can install them now." };
    if (p.all) return { status: "info", message: `${p.all} regular update${p.all === 1 ? "" : "s"} available.` };
    return { status: "ok", message: "Everything is up to date." };
  },
  fix: {
    label: "Install updates",
    describe: async () => {
      const p = await pending();
      return `Download and install ${p.all} update${p.all === 1 ? "" : "s"} (${p.security} security).\nYour apps keep running. This can take a few minutes.`;
    },
    async run(log) {
      log("Refreshing package lists…");
      await sh("apt-get update -qq");
      log("Installing updates…");
      await sh("apt-get -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade", log);
      log("Done.");
    },
  },
};
