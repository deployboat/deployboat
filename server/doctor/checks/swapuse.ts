// Swap mostly full = the server is really short on memory.
import { readFileSync } from "node:fs";
import type { Check } from "../types.ts";

export const swapUse: Check = {
  id: "swapuse",
  title: "Swap usage",
  async check() {
    const mi = Object.fromEntries(readFileSync("/proc/meminfo", "utf8").split("\n").filter(Boolean).map((l) => { const [k, v] = l.split(":"); return [k, parseInt(v)]; }));
    if (!mi.SwapTotal) return { status: "ok", message: "No swap (see the Memory check)." };
    const pct = Math.round((100 * (mi.SwapTotal - mi.SwapFree)) / mi.SwapTotal);
    if (pct >= 80) return { status: "warn", message: `Swap is ${pct}% full. The server is short on memory and will feel slow.`, link: "#/system/memory" };
    return { status: "ok", message: `Swap ${pct}% used.` };
  },
};
