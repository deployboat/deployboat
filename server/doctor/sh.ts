// Run a fixed shell command. Only ever called with strings written in this folder.
import { run } from "../lib/shell.ts";

export const sh = (cmd: string, log?: (l: string) => void) =>
  run("bash", ["-c", `export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a; ${cmd}`], log);

export const shOk = (cmd: string) => sh(cmd).then(() => true, () => false);
