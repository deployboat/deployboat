// Step 2: replace the old container with a new one, with the app's env vars.
import { run } from "../lib/shell.ts";
import { getEnv } from "../lib/env.ts";
import { setStopped } from "../lib/db.ts";

import { containerName, prepareNetwork } from "./network.ts";
export { containerName };

export async function start(name: string, image: string, log: (l: string) => void) {
  log("→ Starting…");
  const env = { ...getEnv(name), PORT: "3000" };
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

  await run("docker", ["rm", "-f", containerName(name)]).catch(() => {});
  const network = await prepareNetwork(name); // its own network: can't see other apps
  try {
    await run("docker", [
      "run", "-d",
      "--name", containerName(name),
      "--network", network,
      "--restart", "unless-stopped",
      ...envArgs,
      image,
    ]);
    setStopped(name, false);
  } catch {
    throw new Error("Your app was built but couldn't start. Make sure it listens on the PORT env variable.");
  }
}
