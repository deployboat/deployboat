// Step 1: build a Docker image. Railpack detects the stack (Node, static, Python…).
import { run } from "../lib/shell.ts";

export async function build(name: string, srcDir: string, log: (l: string) => void): Promise<string> {
  const image = `deployboat/${name}:${Date.now()}`;
  log("→ Building (stack is detected automatically)…");
  try {
    await run("railpack", ["build", srcDir, "--name", image], log);
  } catch {
    throw new Error(
      "We couldn't build your project. Check the log above. " +
        "Tip: a website needs an index.html, a Node app needs package.json with a \"start\" script.",
    );
  }
  return image;
}
