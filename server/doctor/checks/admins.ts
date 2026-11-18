// Who can become root with sudo. Warns when that list changes.
import { readFileSync } from "node:fs";
import type { Check } from "../types.ts";
import { baseline, diff } from "./baseline.ts";

const admins = () => {
  const groups = readFileSync("/etc/group", "utf8").split("\n").map((l) => l.split(":"));
  return [...new Set(groups.filter((g) => g[0] === "sudo" || g[0] === "wheel" || g[0] === "admin").flatMap((g) => (g[3] ?? "").split(",").filter(Boolean)))].sort();
};

export const adminUsers: Check = {
  id: "admins",
  title: "Admin users",
  async check() {
    const now = admins(), before = baseline.get("admins");
    if (!before) { baseline.set("admins", now); return { status: "ok", message: now.length ? `Admins: ${now.join(", ")}.` : "Only root is an admin." }; }
    const d = diff(before, now);
    if (d.added.length) return { status: "bad", message: `New admin user: ${d.added.join(", ")}.`, detail: "If you didn't add this account, someone may have broken in." };
    if (d.removed.length) baseline.set("admins", now);
    return { status: "ok", message: now.length ? `Admins: ${now.join(", ")}.` : "Only root is an admin." };
  },
  fix: {
    label: "Mark as expected",
    describe: async () => `Remember these admins as normal: ${admins().join(", ") || "none"}.\nOnly do this if you added them yourself.`,
    async run(log) { baseline.set("admins", admins()); log("Saved."); },
  },
};
