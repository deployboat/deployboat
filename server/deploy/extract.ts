// Step 0: unpack the uploaded .tar.gz into a fresh folder. Max 200 MB.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../lib/config.ts";

const MAX_BYTES = 200 * 1024 * 1024;

export async function extract(name: string, body: ReadableStream): Promise<string> {
  const dir = join(config.dataDir, "apps", name, "src");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Count bytes as they arrive and stop if the upload is too big.
  let total = 0;
  const limit = new Transform({
    transform(chunk, _enc, next) {
      total += chunk.length;
      if (total > MAX_BYTES) return next(new Error("too large"));
      next(null, chunk);
    },
  });

  const tar = spawn("tar", ["-xz", "-C", dir, "--no-same-owner"]);
  const done = new Promise((ok, fail) => tar.on("close", (code) => (code === 0 ? ok(null) : fail(new Error("bad archive")))));

  try {
    await pipeline(Readable.fromWeb(body as any), limit, tar.stdin);
    await done;
  } catch (e) {
    tar.kill();
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      (e as Error).message === "too large"
        ? "Your project is bigger than 200 MB. Remove big files (videos, builds, node_modules) and try again."
        : "The upload was broken. Please try again.",
    );
  }
  return dir;
}
