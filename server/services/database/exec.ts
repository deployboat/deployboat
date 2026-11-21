// Run a command in a database container and get its output, with a size limit
// (so "SELECT * FROM huge_table" can't fill the server's memory).
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export const MAX_OUTPUT = 8 * 1024 * 1024; // 8 MB of text is plenty for a page of results

export function capture(args: string[], { input, max = MAX_OUTPUT }: { input?: string; max?: number } = {}) {
  return new Promise<{ out: string; cut: boolean }>((resolve, reject) => {
    const child = spawn("docker", args);
    const chunks: Buffer[] = []; let size = 0, cut = false, err = "";
    child.stdout.on("data", (d: Buffer) => {
      if (cut) return;
      size += d.length; chunks.push(d);
      if (size > max) { cut = true; child.kill(); }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || cut) return resolve({ out: Buffer.concat(chunks).toString("utf8"), cut });
      // The database's own message is the useful part, like: ERROR:  relation "x" does not exist
      reject(new Error(err.trim().split("\n").filter(Boolean).slice(-3).join("\n").replace(/^(psql|ERROR \d+ \(\w+\)) at line \d+: ?/m, "") || "The query failed."));
    });
    child.stdin.end(input);
  });
}

// Stream a command's output into a file, or a file into a command (for backups).
export function pipeFile(args: string[], io: { out?: string; in?: string }) {
  const child = spawn("docker", args, { stdio: [io.in ? "pipe" : "ignore", io.out ? "pipe" : "ignore", "pipe"] });
  let err = "";
  child.stderr!.on("data", (d) => (err += d));
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || "The database command failed."))));
  });
  const streamed = io.out ? pipeline(child.stdout!, createWriteStream(io.out))
    : io.in ? pipeline(createReadStream(io.in), child.stdin!) : Promise.resolve();
  return Promise.all([exited, streamed]).then(() => {});
}
