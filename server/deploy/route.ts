// Step 3: tell Caddy about every app. Caddy handles domains + HTTPS for us.
// We write the full config to a file (built from the database), then ask Caddy to reload it.
// Simple, self-healing, and survives reboots.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { run } from "../lib/shell.ts";
import { containerName } from "./run.ts";

const route = (host: string, dial: string) => ({
  match: [{ host: [host] }],
  handle: [{ handler: "reverse_proxy", upstreams: [{ dial }] }],
});

export async function syncRoutes() {
  const apps = db.prepare("SELECT name FROM apps").all() as { name: string }[];
  const routes = [
    route(config.dashboardHost, `host.docker.internal:${config.port}`),
    ...apps.map((a) => route(`${a.name}.${config.baseDomain}`, `${containerName(a.name)}:3000`)),
  ];

  const caddyConfig = {
    apps: { http: { servers: { main: { listen: [":80", ":443"], routes } } } },
  };

  // This folder is mounted into the Caddy container as /data.
  const dir = join(config.dataDir, "caddy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(caddyConfig, null, 2));

  await run("docker", ["exec", "caddy", "caddy", "reload", "--config", "/data/config.json"]);
}
