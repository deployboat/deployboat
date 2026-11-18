// Failed SSH logins in the last day, and how many addresses fail2ban blocked.
// Good to know, not a problem: every public server gets these.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const logins: Check = {
  id: "logins",
  title: "Login attempts",
  async check() {
    const failed = Number(await sh("journalctl -u ssh -u sshd --since '24 hours ago' --no-pager 2>/dev/null | grep -cE 'Failed password|Invalid user' || true")) || 0;
    const banned = Number(await sh("fail2ban-client status sshd 2>/dev/null | grep -oP 'Total banned:\\s*\\K\\d+' || true")) || 0;
    if (!failed) return { status: "ok", message: "No failed SSH logins in the last day." };
    return { status: "info", message: `${failed.toLocaleString()} failed SSH logins in the last day${banned ? `, ${banned} address${banned === 1 ? "" : "es"} blocked by fail2ban` : ""}.`,
      detail: "Bots try every public server. With password login off, they can't get in." };
  },
};
