// System logs without a size limit can slowly fill the disk.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

const FILE = "/etc/systemd/journald.conf.d/90-deployboat.conf";

export const journal: Check = {
  id: "journal",
  title: "System log size",
  async check() {
    const size = await sh("journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMGT]'").catch(() => "?");
    if (existsSync(FILE)) return { status: "ok", message: `System logs use ${size}, capped at 500 MB.` };
    const limited = /SystemMaxUse=\S/.test(await sh("cat /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*.conf 2>/dev/null | grep -v '^#' || true"));
    return limited ? { status: "ok", message: `System logs use ${size}, with a size limit.` }
      : { status: "info", message: `System logs use ${size} and have no size limit.` };
  },
  fix: {
    label: "Cap at 500 MB",
    describe: async () => "Keep at most 500 MB of system logs. Older entries are removed first.",
    async run(log) {
      mkdirSync("/etc/systemd/journald.conf.d", { recursive: true });
      writeFileSync(FILE, "[Journal]\nSystemMaxUse=500M\n");
      await sh("systemctl restart systemd-journald && journalctl --vacuum-size=500M", log);
    },
  },
};
