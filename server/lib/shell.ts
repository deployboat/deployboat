// Run a command and send each output line to `onLine`.
import { spawn } from "node:child_process";

export function run(cmd: string, args: string[], onLine: (line: string) => void = () => {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env });
    const read = (chunk: Buffer) =>
      chunk.toString().split("\n").filter(Boolean).forEach(onLine);
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}
