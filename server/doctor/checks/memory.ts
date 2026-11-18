// Memory and swap. Fix: add a 2 GB swap file.
import os from "node:os";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

async function swapTotal() {
  const out = await sh("free -b | awk '/^Swap:/ {print $2}'").catch(() => "0");
  return Number(out) || 0;
}

export const memory: Check = {
  id: "memory",
  title: "Memory",
  async check() {
    const total = os.totalmem(), used = total - os.freemem();
    const pct = Math.round((used / total) * 100);
    const swap = await swapTotal();
    const gbs = (b: number) => (b / 1024 ** 3).toFixed(1);
    if (!swap && total < 4 * 1024 ** 3)
      return { status: "warn", message: `No swap and only ${gbs(total)} GB of memory.`, detail: "Builds can crash when memory runs out. A swap file gives you a safety margin." };
    if (pct >= 90) return { status: "warn", message: `Memory is ${pct}% used.`, detail: "Apps may get slow or be stopped. Consider a bigger server or fewer apps." };
    return { status: "ok", message: `${pct}% of ${gbs(total)} GB used${swap ? `, ${gbs(swap)} GB swap` : ""}.` };
  },
  fix: {
    label: "Add swap",
    describe: async () => "Create a 2 GB swap file at /swapfile and turn it on, now and after restarts.",
    async run(log) {
      if (await swapTotal()) { log("Swap is already on."); return; }
      await sh("fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile");
      await sh("grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab");
      log("Swap file added and turned on.");
    },
  },
};
