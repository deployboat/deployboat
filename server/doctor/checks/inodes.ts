// Inodes: a disk can be "full" of files even with free space (many tiny files).
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";
import { disk } from "./disk.ts";

export const inodes: Check = {
  id: "inodes",
  title: "Files on disk",
  async check() {
    const pct = Number((await sh("df -iP / | tail -1 | awk '{print $5}'")).replace("%", "")) || 0;
    if (pct >= 90) return { status: "bad", message: `${pct}% of the disk's file slots are used.`, detail: "New files can't be created soon, even with free space." };
    if (pct >= 80) return { status: "warn", message: `${pct}% of the disk's file slots are used.` };
    return { status: "ok", message: `${pct}% of file slots used.` };
  },
  fix: disk.fix, // the same cleanup frees file slots too
};
