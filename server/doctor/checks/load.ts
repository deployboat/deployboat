// Busy for a while, not just a spike: the 15-minute load compared to the number of cores.
import os from "node:os";
import type { Check } from "../types.ts";

export const load: Check = {
  id: "load",
  title: "Server load",
  async check() {
    const cores = os.cpus().length, l15 = os.loadavg()[2];
    const ratio = l15 / cores;
    if (ratio > 2) return { status: "bad", message: `Overloaded for the last 15 minutes (${l15.toFixed(1)} on ${cores} core${cores === 1 ? "" : "s"}).`, detail: "Apps will feel slow. See what's busy.", link: "#/system/cpu" };
    if (ratio > 1.2) return { status: "warn", message: `Busy for the last 15 minutes (${l15.toFixed(1)} on ${cores} core${cores === 1 ? "" : "s"}).`, link: "#/system/cpu" };
    return { status: "ok", message: `Load ${l15.toFixed(2)} on ${cores} core${cores === 1 ? "" : "s"}.` };
  },
};
