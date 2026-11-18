// Each app gets its own Docker network, so apps can't reach each other.
//
//   app-shop-net:  app-shop  +  caddy  (+ postgres if shop has a database)  (+ garage if it has storage)
//   deployboat:    caddy, postgres, garage   (the shared "service" network)
//
// Service names stay the same inside every network (postgres, garage), so
// DATABASE_URL and S3_ENDPOINT don't change.
import { run } from "../lib/shell.ts";
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { enabled as hasDatabase } from "../services/postgres/index.ts";
import { enabled as hasStorage } from "../services/files/index.ts";

export const containerName = (app: string) => `app-${app}`;
export const appNetwork = (app: string) => `${containerName(app)}-net`;

const docker = (...args: string[]) => run("docker", args);
const quiet = (p: Promise<unknown>) => p.catch(() => {}); // "already connected", "doesn't exist"…

// Create the app's network (if needed) and connect what the app may talk to.
export async function prepareNetwork(app: string) {
  const net = appNetwork(app);
  await docker("network", "inspect", net).catch(() => docker("network", "create", "--label", `deployboat.app=${app}`, net));
  await quiet(docker("network", "connect", net, "caddy"));
  if (hasDatabase(app)) await quiet(docker("network", "connect", net, "postgres"));
  else await quiet(docker("network", "disconnect", net, "postgres"));
  if (hasStorage(app)) await quiet(docker("network", "connect", net, "garage"));
  else await quiet(docker("network", "disconnect", net, "garage"));
  return net;
}

export async function removeNetwork(app: string) {
  const net = appNetwork(app);
  for (const c of ["caddy", "postgres", "garage", containerName(app)]) await quiet(docker("network", "disconnect", "-f", net, c));
  await quiet(docker("network", "rm", net));
}

// The app's IP on its own network. Deploy Boat runs outside Docker, so it can't use the name.
export const containerIp = (app: string) =>
  docker("inspect", "-f", `{{(index .NetworkSettings.Networks "${appNetwork(app)}").IPAddress}}`, containerName(app));

// Where Caddy (on the service network) reaches Deploy Boat: that network's gateway.
// Using the gateway (not host.docker.internal) keeps Caddy's traffic on the service
// network, which is the only network the firewall lets talk to Deploy Boat.
export const serviceGateway = () =>
  docker("network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", config.dockerNetwork);

// Move apps that still live on the shared network to their own (servers set up before this change).
export async function isolateExistingApps() {
  // Caddy must be able to join the new networks, or the sites would go offline. Try again next start.
  if ((await docker("inspect", "-f", "{{.State.Running}}", "caddy").catch(() => "")) !== "true") return;
  const apps = (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name);
  for (const app of apps) {
    const nets = await docker("inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}", containerName(app)).catch(() => "");
    if (!nets) continue; // no container (never deployed, or deleted)
    if (nets.includes(appNetwork(app)) && !nets.split(" ").includes(config.dockerNetwork)) continue;
    await prepareNetwork(app);
    await quiet(docker("network", "connect", appNetwork(app), containerName(app)));
    await quiet(docker("network", "disconnect", config.dockerNetwork, containerName(app)));
  }
}
