// The built-in services: web server, database, file storage, app builder.
import type { Check } from "../types.ts";
import { run } from "../../lib/shell.ts";

const SERVICES: Record<string, string> = { caddy: "Web server", buildkit: "App builder", postgres: "Database (PostgreSQL)", mysql: "Database (MySQL)", garage: "File storage" };

// "running", "exited"… or "" when the container doesn't exist (not set up yet).
const state = (name: string) => run("docker", ["inspect", "-f", "{{.State.Status}}", name]).catch(() => "");

async function down() {
  const states = await Promise.all(Object.keys(SERVICES).map(async (n) => [n, await state(n)] as const));
  return states.filter(([, s]) => s && s !== "running").map(([n]) => n);
}

export const services: Check = {
  id: "services",
  title: "Built-in services",
  async check() {
    const d = await down();
    if (d.length) return { status: "bad", message: `Not running: ${d.map((n) => SERVICES[n]).join(", ")}.`, detail: "Apps that depend on them won't work." };
    return { status: "ok", message: "Web server, builder, database and storage are running." };
  },
  fix: {
    label: "Start them",
    describe: async () => `Start: ${(await down()).map((n) => SERVICES[n]).join(", ") || "nothing (all running)"}.`,
    async run(log) {
      for (const n of await down()) {
        await run("docker", ["start", n]);
        log(`${SERVICES[n]} started.`);
      }
    },
  },
};
