// Step 1: build a Docker image. Railpack detects the stack (Node, static, Python…).
import { run } from "../lib/shell.ts";

export async function build(name: string, srcDir: string, log: (l: string) => void): Promise<string> {
  const image = `deployboat/${name}:${Date.now()}`;
  log("→ Building (stack is detected automatically)…");
  await run("railpack", ["build", srcDir, "--name", image], log);
  return image;
}
