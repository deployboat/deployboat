// Docker can publish a container's port straight to the internet, around the firewall.
// Only Caddy (80, 443) should do that. No automatic fix: removing it could break something you set up.
import type { Check } from "../types.ts";
import { run } from "../../lib/shell.ts";

export const exposedPorts: Check = {
  id: "exposedports",
  title: "Open container ports",
  async check() {
    const out = await run("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]).catch(() => "");
    const open: string[] = [];
    for (const line of out.split("\n").filter(Boolean)) {
      const [name, ports] = line.split("\t");
      if (name === "caddy") continue;
      for (const m of (ports ?? "").matchAll(/(?:0\.0\.0\.0|\[::\]|::):(\d+)->/g)) open.push(`${name} (port ${m[1]})`);
    }
    const list = [...new Set(open)];
    if (!list.length) return { status: "ok", message: "Only the web server is reachable from the internet." };
    return { status: "warn", message: `Reachable from the internet, around the firewall: ${list.join(", ")}.`,
      detail: "Docker ignores the firewall for published ports. If you didn't mean this, recreate the container without -p, or with -p 127.0.0.1:PORT:PORT." };
  },
};
