// SSH keys that can log in. Warns when one is added.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Check } from "../types.ts";
import { baseline, diff } from "./baseline.ts";

function keys() {
  const homes = [["root", "/root"]];
  try { for (const u of readdirSync("/home")) homes.push([u, `/home/${u}`]); } catch {}
  const out: string[] = [];
  for (const [user, home] of homes) {
    const f = `${home}/.ssh/authorized_keys`;
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/(ssh-\S+|ecdsa-\S+|sk-\S+)\s+(\S+)(?:\s+(.*))?/);
      if (m) out.push(`${user}: ${m[3]?.trim() || m[1]} …${m[2].slice(-8)}`);
    }
  }
  return out.sort();
}

export const sshKeys: Check = {
  id: "sshkeys",
  title: "SSH keys",
  async check() {
    const now = keys(), before = baseline.get("sshkeys");
    if (!before) { baseline.set("sshkeys", now); return { status: "ok", message: `${now.length} SSH key${now.length === 1 ? "" : "s"} can log in.` }; }
    const d = diff(before, now);
    if (d.added.length) return { status: "bad", message: `New SSH key: ${d.added.join("; ")}.`, detail: "If you didn't add it, someone may have access to this server." };
    if (d.removed.length) baseline.set("sshkeys", now);
    return { status: "ok", message: `${now.length} SSH key${now.length === 1 ? "" : "s"} can log in, none new.` };
  },
  fix: {
    label: "Mark as expected",
    describe: async () => `Remember these keys as normal:\n${keys().join("\n")}\nOnly do this if you added them yourself.`,
    async run(log) { baseline.set("sshkeys", keys()); log("Saved."); },
  },
};
