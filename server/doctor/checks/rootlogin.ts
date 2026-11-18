// Root login over SSH with a password. Fix: root may only log in with an SSH key.
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

const CONF = "/etc/ssh/sshd_config.d/00-deployboat-root.conf"; // read before cloud-init's 50-*.conf, so it wins
const rootHasKey = () => existsSync("/root/.ssh/authorized_keys") && /ssh-|ecdsa-/.test(readFileSync("/root/.ssh/authorized_keys", "utf8"));

export const rootLogin: Check = {
  id: "rootlogin",
  title: "Root login",
  async check() {
    const cfg = await sh("sshd -T 2>/dev/null").catch(() => "");
    const mode = cfg.match(/^permitrootlogin (\S+)/m)?.[1];
    if (!mode) return { status: "info", message: "Couldn't read the SSH settings." };
    if (mode === "yes")
      return rootHasKey()
        ? { status: "warn", message: "Root can log in over SSH with a password.", detail: "Bots guess root passwords all day. Your root SSH key keeps working after the fix." }
        : { status: "warn", canFix: false, message: "Root can log in over SSH with a password.", detail: "Add an SSH key for root first (ssh-copy-id root@this-server), then come back." };
    return { status: "ok", message: mode === "no" ? "Root can't log in over SSH." : "Root can only log in with an SSH key." };
  },
  fix: {
    label: "Keys only for root",
    describe: async () => "Let root log in over SSH with a key only, never a password.\nThe setting is checked before it's applied, so a mistake can't lock you out.",
    async run(log) {
      if (!rootHasKey()) throw new Error("Root has no SSH key. Not changing anything.");
      writeFileSync(CONF, "PermitRootLogin prohibit-password\n");
      try { await sh("sshd -t"); } catch { rmSync(CONF, { force: true }); throw new Error("The new setting didn't pass the check. Nothing was changed."); }
      await sh("systemctl reload ssh 2>/dev/null || systemctl reload sshd");
      log("Root can now only log in with an SSH key.");
    },
  },
};
