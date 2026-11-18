// SSH password login. Fix: turn it off, but only if someone can still log in with a key.
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

// Read by sshd before cloud-init's 50-*.conf, so our setting wins.
const CONF = "/etc/ssh/sshd_config.d/00-deployboat.conf";

function hasKeys() {
  const files = ["/root/.ssh/authorized_keys"];
  try { for (const u of readdirSync("/home")) files.push(`/home/${u}/.ssh/authorized_keys`); } catch {}
  return files.some((f) => existsSync(f) && /ssh-|ecdsa-/.test(readFileSync(f, "utf8")));
}

export const ssh: Check = {
  id: "ssh",
  title: "SSH login",
  async check() {
    const cfg = await sh("sshd -T 2>/dev/null").catch(() => "");
    if (!cfg) return { status: "info", message: "Couldn't read the SSH settings." };
    if (!/^passwordauthentication yes/m.test(cfg)) return { status: "ok", message: "Password login is off. Only SSH keys work." };
    if (!hasKeys())
      return { status: "warn", canFix: false, message: "SSH allows password login.",
        detail: "Add an SSH key first (ssh-copy-id from your computer), then come back to turn passwords off safely." };
    return { status: "warn", message: "SSH allows password login.", detail: "Bots try passwords all day. Keys are much safer, and you already have one." };
  },
  fix: {
    label: "Turn off passwords",
    describe: async () => "Allow SSH login with keys only. Your existing key keeps working.\nThe new settings are checked before they're applied, so a mistake can't lock you out.",
    async run(log) {
      if (!hasKeys()) throw new Error("No SSH key found. Not changing anything.");
      writeFileSync(CONF, "PasswordAuthentication no\nKbdInteractiveAuthentication no\n");
      try { await sh("sshd -t"); }
      catch { rmSync(CONF, { force: true }); throw new Error("The new settings didn't pass the check. Nothing was changed."); }
      await sh("systemctl reload ssh 2>/dev/null || systemctl reload sshd");
      log("Password login is off.");
    },
  },
};
