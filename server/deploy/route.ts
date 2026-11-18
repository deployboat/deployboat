// Step 3: tell Caddy about every app. Caddy handles domains + HTTPS for us.
// We always send the full config, built from the database. Simple and self-healing.
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
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
    admin: { listen: "0.0.0.0:2019" },
    apps: { http: { servers: { main: { listen: [":80", ":443"], routes } } } },
  };

  const res = await fetch(`${config.caddyAdmin}/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(caddyConfig),
  });
  if (!res.ok) throw new Error(`Caddy said: ${await res.text()}`);
}
