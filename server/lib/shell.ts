// Run a command and send each output line to `onLine`. Resolves with all output.
import { spawn } from "node:child_process";

export function run(cmd: string, args: string[], onLine: (line: string) => void = () => {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env });
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      chunk.toString().split("\n").filter(Boolean).forEach(onLine);
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}
