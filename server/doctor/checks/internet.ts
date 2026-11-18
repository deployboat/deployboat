// Builds download packages: the server needs working DNS and internet.
import { resolve4 } from "node:dns/promises";
import type { Check } from "../types.ts";

const SITES = ["github.com", "registry-1.docker.io", "registry.npmjs.org"];

export const internet: Check = {
  id: "internet",
  title: "Internet and DNS",
  async check() {
    const dnsFail = (await Promise.all(SITES.map((h) => resolve4(h).then(() => null, () => h)))).filter(Boolean);
    if (dnsFail.length === SITES.length) return { status: "bad", message: "DNS isn't working: the server can't look up any address.", detail: "Builds and updates will fail. Check /etc/resolv.conf or your provider's network settings." };
    const unreachable = (await Promise.all(SITES.map((h) =>
      fetch(`https://${h}/`, { method: "HEAD", signal: AbortSignal.timeout(8000) }).then(() => null, () => h)))).filter(Boolean);
    if (unreachable.length) return { status: "warn", message: `Can't reach: ${unreachable.join(", ")}.`, detail: "Builds that need them will fail." };
    return { status: "ok", message: "DNS works and package sources are reachable." };
  },
};
