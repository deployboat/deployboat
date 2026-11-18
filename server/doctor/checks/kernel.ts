// Safe kernel network protections, the kind every server checklist recommends.
// Nothing here affects Docker (IP forwarding is left alone).
import { writeFileSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

const FILE = "/etc/sysctl.d/90-deployboat.conf";
const WANT: Record<string, string> = {
  "net.ipv4.tcp_syncookies": "1",                 // survive SYN floods
  "net.ipv4.conf.all.rp_filter": "2",             // drop spoofed source addresses ("loose": safe with Docker)
  "net.ipv4.conf.default.rp_filter": "2",
  "net.ipv4.conf.all.accept_redirects": "0",      // ignore ICMP redirects (route hijacking)
  "net.ipv4.conf.default.accept_redirects": "0",
  "net.ipv6.conf.all.accept_redirects": "0",
  "net.ipv4.conf.all.send_redirects": "0",
  "net.ipv4.conf.all.accept_source_route": "0",
  "net.ipv4.icmp_echo_ignore_broadcasts": "1",
  "net.ipv4.conf.all.log_martians": "1",          // log impossible packets
  "kernel.kptr_restrict": "2",                    // hide kernel addresses
  "kernel.dmesg_restrict": "1",                   // kernel log for root only
  "fs.protected_symlinks": "1",
  "fs.protected_hardlinks": "1",
  "vm.swappiness": "10",                          // health: use memory before swap
};

async function missing() {
  const keys = Object.keys(WANT);
  const out = await sh(`sysctl ${keys.join(" ")} 2>/dev/null || true`);
  const now = Object.fromEntries(out.split("\n").map((l) => l.split(" = ")).filter((p) => p.length === 2));
  // rp_filter: strict (1) is fine too; only "off" (0) is a problem.
  const ok = (k: string, v: string) => (k.includes("rp_filter") ? v !== "0" : v === WANT[k]);
  return keys.filter((k) => k in now && !ok(k, now[k].trim()));
}

export const kernel: Check = {
  id: "kernel",
  title: "Kernel protections",
  async check() {
    const m = await missing();
    if (!m.length) return { status: "ok", message: "Network and kernel protections are on." };
    return { status: "warn", message: `${m.length} recommended kernel setting${m.length === 1 ? " is" : "s are"} off.`,
      detail: "Protection against SYN floods, spoofed packets and route hijacking." };
  },
  fix: {
    label: "Turn on protections",
    describe: async () => `Apply these settings now and after every restart (${FILE}):\n${(await missing()).join("\n")}`,
    async run(log) {
      writeFileSync(FILE, "# Written by Deploy Boat (Server Doctor)\n" + Object.entries(WANT).map(([k, v]) => `${k} = ${v}`).join("\n") + "\n");
      await sh(`sysctl -p ${FILE}`, log);
      log("Done.");
    },
  },
};
