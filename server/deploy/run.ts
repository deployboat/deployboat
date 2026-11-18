// Step 2: replace the old container with a new one.
import { run } from "../lib/shell.ts";
import { config } from "../lib/config.ts";

export const containerName = (name: string) => `app-${name}`;

export async function start(name: string, image: string, log: (l: string) => void) {
  log("→ Starting…");
  await run("docker", ["rm", "-f", containerName(name)]).catch(() => {});
  await run("docker", [
    "run", "-d",
    "--name", containerName(name),
    "--network", config.dockerNetwork,
    "--restart", "unless-stopped",
    "-e", "PORT=3000",
    image,
  ]);
}
