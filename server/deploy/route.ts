// Step 3: tell Caddy about every app. Caddy handles domains + HTTPS for us.
// We write the full config to a file (built from the database), then ask Caddy to reload it.
// Simple, self-healing, and survives reboots.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { run } from "../lib/shell.ts";
import { containerName } from "./run.ts";
import { serviceGateway } from "./network.ts";
import { filesHost, webUpstream, enabled as hasStorage } from "../services/files/index.ts";
import { domainsOf, appHosts, dashboardHosts } from "../lib/domains.ts";
import { getShare } from "../lib/share.ts";

// A list of hosts without repeats. Caddy refuses the whole config (and every site goes
// down) if a host is listed twice, e.g. files.app.<domain> and files.app.<ip>.nip.io are
// the same name when the server has no domain of its own yet.
const unique = (hosts: string[]) => [...new Set(hosts)];

// Send requests for `hosts` to `dial`. Optionally rewrite the Host header.
const route = (hosts: string | string[], dial: string, hostHeader?: string) => ({
  match: [{ host: unique([hosts].flat()) }],
  handle: [{
    handler: "reverse_proxy",
    upstreams: [{ dial }],
    ...(hostHeader && { headers: { request: { set: { Host: [hostHeader] } } } }),
  }],
});

// Routes for one app. Password-protected apps get three:
//   1. ?share=<token>  → set a cookie and redirect (the private link)
//   2. has that cookie → straight to the app
//   3. everyone else   → username/password prompt, then the app
function appRoutes(app: string) {
  const hosts = unique([...appHosts(app), ...domainsOf(app)]);
  const proxy = { handler: "reverse_proxy", upstreams: [{ dial: `${containerName(app)}:3000` }] };
  const s = getShare(app);
  if (s.mode !== "password" || !s.password_hash || !s.token) return [{ match: [{ host: hosts }], handle: [proxy], terminal: true }];

  const cookie = `deployboat_share=${s.token}`;
  return [
    {
      match: [{ host: hosts, query: { share: [s.token] } }],
      handle: [{
        handler: "static_response",
        status_code: 302,
        headers: {
          Location: ["{http.request.uri.path}"],
          "Set-Cookie": [`${cookie}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`],
        },
      }],
      terminal: true,
    },
    { match: [{ host: hosts, header: { Cookie: [`*${cookie}*`] } }], handle: [proxy], terminal: true },
    {
      match: [{ host: hosts }],
      handle: [
        { handler: "authentication", providers: { http_basic: { realm: "Private site", accounts: [{ username: s.username, password: s.password_hash }] } } },
        proxy,
      ],
      terminal: true,
    },
  ];
}

export async function syncRoutes() {
  const apps = db.prepare("SELECT name FROM apps").all() as { name: string }[];
  const routes = [
    route(dashboardHosts(), `${await serviceGateway().catch(() => "host.docker.internal")}:${config.port}`),
    // Free addresses + custom domains, with password protection if it's on.
    ...apps.flatMap((a) => appRoutes(a.name)),
    ...apps.filter((a) => hasStorage(a.name)).map((a) => route([filesHost(a.name), `files.${a.name}.${config.nipDomain}`], webUpstream.dial, webUpstream.host(a.name))),
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
