// Firewall rules that open more than SSH, web and HTTPS to the internet.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

export const extraPorts: Check = {
  id: "extraports",
  title: "Extra open ports",
  async check() {
    const out = await sh("ufw status 2>/dev/null").catch(() => "");
    if (!/Status: active/.test(out)) return { status: "info", message: "The firewall is off (see the Firewall check)." };
    const extra = new Set<string>();
    for (const line of out.split("\n")) {
      const m = line.match(/^(\S+)\s+ALLOW\s+(?:IN\s+)?Anywhere/);
      if (!m) continue; // rules limited to one address (like Caddy's) are fine
      const port = m[1].replace(/\s*\(v6\)$/, "");
      if (!/^(22|80|443)(\/(tcp|udp))?$/.test(port) && !/^(OpenSSH|Nginx|Apache)/i.test(port)) extra.add(port);
    }
    if (!extra.size) return { status: "ok", message: "Only SSH, web and HTTPS are open to the internet." };
    return { status: "warn", message: `Also open to everyone: ${[...extra].join(", ")}.`,
      detail: "If you don't need these, remove them: sudo ufw delete allow <port>" };
  },
};
