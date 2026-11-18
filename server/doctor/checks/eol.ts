// Is this Ubuntu/Debian version still getting security updates?
import { readFileSync } from "node:fs";
import type { Check } from "../types.ts";

// End of standard security support (Ubuntu LTS: standard support; Debian: LTS end).
const EOL: Record<string, string> = {
  "ubuntu 20.04": "2025-05-31", "ubuntu 22.04": "2027-06-30", "ubuntu 24.04": "2029-06-30", "ubuntu 26.04": "2031-06-30",
  "debian 11": "2026-08-31", "debian 12": "2028-06-30", "debian 13": "2030-06-30",
};

export const eol: Check = {
  id: "eol",
  title: "System support",
  async check() {
    const os = Object.fromEntries(readFileSync("/etc/os-release", "utf8").split("\n").map((l) => l.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, v.replace(/"/g, "")]));
    const end = EOL[`${os.ID} ${os.VERSION_ID}`];
    if (!end) return { status: "info", message: `${os.PRETTY_NAME}: support end date unknown.` };
    const days = Math.floor((Date.parse(end) - Date.now()) / 86400000);
    if (days < 0) return { status: "bad", message: `${os.PRETTY_NAME} no longer gets security updates (ended ${end}).`, detail: "Move your apps to a server with a newer version (back up, install Deploy Boat there, restore)." };
    if (days < 180) return { status: "warn", message: `${os.PRETTY_NAME} stops getting security updates on ${end}.`, detail: "Plan a move to a newer version." };
    return { status: "ok", message: `${os.PRETTY_NAME} gets security updates until ${end}.` };
  },
};
