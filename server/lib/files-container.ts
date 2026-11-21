// Files page, when the app is running: every file inside its container.
//
// Everything goes through `docker exec` with small shell scripts, as root, so you can
// reach every file (the app itself may run as another user). Paths are passed to the
// scripts as arguments ("$1"), never pasted into them, so a file name can't run commands.
//
// Needs a shell (sh) in the image. Almost every image has one; very small "distroless"
// ones don't, and then the Files page falls back to files-saved.ts.
import { spawn } from "node:child_process";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { run } from "./shell.ts";
import { containerName } from "../deploy/network.ts";

export type Entry = { name: string; dir: boolean; link: boolean; size: number; modified: string };

// Thrown when the image has no shell, so the caller can fall back.
export class NoShell extends Error {}

// "/app/./src//x/" → "/app/src/x". Throws on anything that isn't a full path.
export function cleanPath(path: string) {
  if (!path.startsWith("/") || path.includes("\0")) throw new Error("Use a full path, like /app/package.json.");
  return posix.normalize(path).replace(/(.)\/$/, "$1");
}

// Run a script in the container. `input` is sent to it, and its output comes back as bytes.
function sh(app: string, script: string, args: string[], input?: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "-u", "0", containerName(app), "sh", "-c", script, "sh", ...args]);
    const out: Buffer[] = []; let err = "";
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(out));
      if (/executable file not found|no such file or directory: unknown/i.test(err)) return reject(new NoShell("no shell"));
      // The last line from the script (or the command that failed) is the reason.
      reject(new Error(err.trim().split("\n").pop()?.replace(/^.*?: /, "") || "That didn't work."));
    });
    child.stdin.end(input);
  });
}

// Can we run scripts in it? False if the image has no shell.
export const hasShell = (app: string) =>
  sh(app, "true", []).then(() => true, (e) => { if (e instanceof NoShell) return false; throw e; });

// The folder the app starts in (usually /app), to open first.
export const workDir = async (app: string) =>
  (await run("docker", ["inspect", "-f", "{{.Config.WorkingDir}}", containerName(app)]).catch(() => "")) || "/";

// One line per entry: type, size, modified (unix time), name. Works with GNU and busybox.
const LIST = `cd -- "$1" || exit 1
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  if [ -d "$f" ]; then t=d; else t=f; fi
  [ -L "$f" ] && t="$t"l
  printf '%s\\t%s\\t%s\\n' "$t" "$(stat -L -c '%s %Y' -- "$f" 2>/dev/null || echo 0 0)" "$f"
done`;

export async function listFolder(app: string, path: string): Promise<Entry[]> {
  const out = (await sh(app, LIST, [cleanPath(path)])).toString("utf8");
  return out.split("\n").filter(Boolean).map((line) => {
    const [type, sizeTime, ...name] = line.split("\t");
    const [size, time] = sizeTime.split(" ");
    return {
      name: name.join("\t"), dir: type.startsWith("d"), link: type.endsWith("l"), size: Number(size) || 0,
      modified: new Date(Number(time) * 1000).toISOString().replace("T", " ").slice(0, 19), // same format as the database
    };
  }).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

// The file's bytes. Throws "too big" past `max` bytes, without reading it.
export async function readFile(app: string, path: string, max: number) {
  return sh(app, `[ -f "$1" ] || { echo "File not found." >&2; exit 1; }
    [ "$(stat -c %s -- "$1")" -le "$2" ] || { echo "too big" >&2; exit 1; }
    cat -- "$1"`, [cleanPath(path), String(max)]);
}

// Write a file. A new file gets the owner of its folder, so the app can still change it.
export async function writeFile(app: string, path: string, data: Uint8Array) {
  await sh(app, `[ -d "$1" ] && { echo "There's a folder with that name." >&2; exit 1; }
    d=$(dirname -- "$1"); mkdir -p -- "$d" || exit 1
    new=0; [ -e "$1" ] || new=1
    cat > "$1" || exit 1
    [ $new = 1 ] && chown "$(stat -c %u:%g -- "$d")" -- "$1" 2>/dev/null
    exit 0`, [cleanPath(path)], data);
}

export async function makeFolder(app: string, path: string) {
  await sh(app, `mkdir -p -- "$1" && chown "$(stat -c %u:%g -- "$(dirname -- "$1")")" -- "$1" 2>/dev/null; exit 0`, [cleanPath(path)]);
}

// Folders that would break the container if deleted or renamed.
const PROTECTED = ["/", "/bin", "/dev", "/etc", "/lib", "/proc", "/sbin", "/sys", "/usr", "/var", "/run", "/tmp", "/root", "/home"];
const guard = (path: string) => {
  const p = cleanPath(path);
  if (PROTECTED.includes(p)) throw new Error(`${p} is a system folder and can't be changed here.`);
  return p;
};

export async function removeFile(app: string, path: string) {
  await sh(app, `rm -rf -- "$1"`, [guard(path)]);
}

export async function renameFile(app: string, from: string, to: string) {
  await sh(app, `[ -e "$2" ] && { echo "Something with that name is already there." >&2; exit 1; }; mv -- "$1" "$2"`, [guard(from), guard(to)]);
}

// For downloads: the file as a stream (no size limit, nothing kept in memory).
export function streamFile(app: string, path: string) {
  const child = spawn("docker", ["exec", "-u", "0", containerName(app), "cat", "--", cleanPath(path)], { stdio: ["ignore", "pipe", "ignore"] });
  return Readable.toWeb(child.stdout) as ReadableStream;
}
