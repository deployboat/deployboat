// Is unattended-upgrades actually switched on (not just installed)?
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

const FILE = "/etc/apt/apt.conf.d/20auto-upgrades";
const on = () => existsSync(FILE) && /Unattended-Upgrade\s+"1"/.test(readFileSync(FILE, "utf8"));

export const autoUpdates: Check = {
  id: "autoupdates",
  title: "Automatic security updates",
  async check() {
    if (!(await sh("dpkg -s unattended-upgrades >/dev/null 2>&1 && echo yes").catch(() => ""))) return { status: "warn", message: "Automatic security updates aren't installed." };
    return on() ? { status: "ok", message: "Security updates install by themselves every day." }
      : { status: "warn", message: "Automatic security updates are installed but switched off." };
  },
  fix: {
    label: "Switch on",
    describe: async () => "Install unattended-upgrades if needed, and let it install security updates every day.",
    async run(log) {
      await sh("command -v unattended-upgrade >/dev/null || apt-get install -y -qq unattended-upgrades");
      writeFileSync(FILE, 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n');
      log("Automatic security updates are on.");
    },
  },
};
