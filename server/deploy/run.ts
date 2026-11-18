// Step 2: replace the old container with a new one, with the app's env vars.
import { run } from "../lib/shell.ts";
import { config } from "../lib/config.ts";
import { getEnv } from "../lib/env.ts";

export const containerName = (name: string) => `app-${name}`;

export async function start(name: string, image: string, log: (l: string) => void) {
  log("→ Starting…");
  const env = { ...getEnv(name), PORT: "3000" };
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

  await run("docker", ["rm", "-f", containerName(name)]).catch(() => {});
  try {
    await run("docker", [
      "run", "-d",
      "--name", containerName(name),
      "--network", config.dockerNetwork,
      "--restart", "unless-stopped",
      ...envArgs,
      image,
    ]);
  } catch {
    throw new Error("Your app was built but couldn't start. Make sure it listens on the PORT env variable.");
  }
}
