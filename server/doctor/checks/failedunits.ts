// System services that crashed and stayed down.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const failedUnits: Check = {
  id: "failedunits",
  title: "System services",
  async check() {
    const out = await sh("systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}'").catch(() => "");
    const units = out.split("\n").filter(Boolean);
    if (!units.length) return { status: "ok", message: "No failed system services." };
    return { status: "warn", message: `Failed: ${units.slice(0, 5).join(", ")}${units.length > 5 ? "…" : ""}.`,
      detail: `See why with: sudo journalctl -u ${units[0]} -n 50` };
  },
};
