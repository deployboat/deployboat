// Step 0: unpack the uploaded .tar.gz. Max 200 MB.
//
// Unpacking is done by the unprivileged "nobody" user, in a staging folder outside
// Deploy Boat's data. A crafted archive can't write anywhere it shouldn't.
// When it's done, root moves the folder into place.
import { spawn } from "node:child_process";
import { chmodSync, chownSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../lib/config.ts";

const MAX_BYTES = 200 * 1024 * 1024;
const NOBODY = 65534;
const isRoot = process.getuid?.() === 0;

// Same disk as the data folder, so the final move is instant.
const STAGING = `${config.dataDir.replace(/\/+$/, "")}-staging`;

export async function extract(name: string, body: ReadableStream): Promise<string> {
  mkdirSync(STAGING, { recursive: true });
  chmodSync(STAGING, 0o711); // others can enter their own folder, not list the others
  const tmp = mkdtempSync(join(STAGING, "up-"));
  if (isRoot) chownSync(tmp, NOBODY, NOBODY);

  // Count bytes as they arrive and stop if the upload is too big.
  let total = 0;
  const limit = new Transform({
    transform(chunk, _enc, next) {
      total += chunk.length;
      if (total > MAX_BYTES) return next(new Error("too large"));
      next(null, chunk);
    },
  });

  const tar = spawn("tar", ["-xz", "-C", tmp, "--no-same-owner", "--no-same-permissions"],
    isRoot ? { uid: NOBODY, gid: NOBODY } : {});
  const done = new Promise((ok, fail) => tar.on("close", (code) => (code === 0 ? ok(null) : fail(new Error("bad archive")))));

  try {
    await pipeline(Readable.fromWeb(body as any), limit, tar.stdin);
    await done;
  } catch (e) {
    tar.kill();
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(
      (e as Error).message === "too large"
        ? "Your project is bigger than 200 MB. Remove big files (videos, builds, node_modules) and try again."
        : "The upload was broken. Please try again.",
    );
  }

  const dir = join(config.dataDir, "apps", name, "src");
  mkdirSync(join(config.dataDir, "apps", name), { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return dir;
}
