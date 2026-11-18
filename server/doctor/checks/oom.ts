// Programs killed because the server ran out of memory (last 24 hours).
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const oom: Check = {
  id: "oom",
  title: "Out of memory",
  async check() {
    const out = await sh("journalctl -k --since '24 hours ago' --no-pager 2>/dev/null | grep -i 'killed process' || true");
    const killed = [...out.matchAll(/Killed process \d+ \(([^)]+)\)/gi)].map((m) => m[1]);
    if (!killed.length) return { status: "ok", message: "Nothing was stopped for lack of memory in the last day." };
    const names = [...new Set(killed)];
    return { status: "warn", message: `Ran out of memory ${killed.length} time${killed.length === 1 ? "" : "s"} today. Stopped: ${names.slice(0, 5).join(", ")}.`,
      detail: "Add swap (Memory check), stop apps you don't need, or move to a bigger server.", link: "#/system/memory" };
  },
};
