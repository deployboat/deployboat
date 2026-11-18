// Step 0: unpack the uploaded .tar.gz into a fresh folder.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../lib/config.ts";

export async function extract(name: string, body: ReadableStream): Promise<string> {
  const dir = join(config.dataDir, "apps", name, "src");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const tar = spawn("tar", ["-xz", "-C", dir, "--no-same-owner"]);
  const done = new Promise((ok, fail) => tar.on("close", (code) => (code === 0 ? ok(null) : fail(new Error("Could not unpack upload")))));
  await pipeline(Readable.fromWeb(body as any), tar.stdin);
  await done;
  return dir;
}
