// Files page, when the app isn't running: only its persistent folders, read straight from
// the server's disk (see appdata.ts). When it runs, files-container.ts is used instead.
//
// Paths are the ones the app sees, like "/data/uploads/a.png". We turn them into a path
// on the server and make sure it stays inside one of the folders, so "../" or a symlink
// can't reach anything else on the server.
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, readFileSync, writeFileSync, chmodSync, renameSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { Entry } from "./files-container.ts";
import { dirname, join, relative } from "node:path";
import { mounts } from "./appdata.ts";

// "/data/a/b.txt" → its path on the server. Throws if it's outside the app's folders.
export function resolveFile(app: string, path: string) {
  const clean = "/" + path.split("/").filter((p) => p && p !== ".").join("/");
  if (clean.split("/").includes("..")) throw new Error("Invalid path.");
  const mount = mounts(app).find(([inside]) => clean === inside || clean.startsWith(`${inside}/`));
  if (!mount) throw new Error("That's not in one of this app's persistent folders.");
  const [inside, root] = mount;
  mkdirSync(root, { recursive: true });
  const full = join(root, clean.slice(inside.length));
  // Follow symlinks for the part that exists, and check it's still inside the folder.
  let existing = full;
  while (!existsSync(existing)) existing = dirname(existing);
  const rel = relative(realpathSync(root), realpathSync(existing));
  if (rel.startsWith("..")) throw new Error("That's not in one of this app's persistent folders.");
  return { full, clean, isRoot: clean === inside };
}

export function listFolder(app: string, path: string): Entry[] {
  const { full } = resolveFile(app, path);
  if (!existsSync(full) || !statSync(full).isDirectory()) throw new Error("Folder not found.");
  return readdirSync(full, { withFileTypes: true })
    .map((d) => {
      const st = statSync(join(full, d.name), { throwIfNoEntry: false });
      return { name: d.name, dir: !!st?.isDirectory(), link: d.isSymbolicLink(), size: st?.size ?? 0, modified: st?.mtime.toISOString().replace("T", " ").slice(0, 19) ?? "" /* same format as the database */ };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

// The file's bytes. Throws "too big" past `max` bytes.
export function readFile(app: string, path: string, max: number) {
  const { full } = resolveFile(app, path);
  const st = statSync(full, { throwIfNoEntry: false });
  if (!st?.isFile()) throw new Error("File not found.");
  if (st.size > max) throw new Error("too big");
  return readFileSync(full);
}

export function writeFile(app: string, path: string, data: string | Uint8Array) {
  const { full, isRoot } = resolveFile(app, path);
  if (isRoot) throw new Error("Pick a file name.");
  if (existsSync(full) && statSync(full).isDirectory()) throw new Error("There's a folder with that name.");
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  // The app may run as a non-root user: let it keep writing to the file (see appdata.ts).
  try { chmodSync(full, 0o666); } catch { /* not root */ }
}

export function makeFolder(app: string, path: string) {
  const { full } = resolveFile(app, path);
  mkdirSync(full, { recursive: true });
  try { chmodSync(full, 0o777); } catch { /* not root */ }
}

export function removeFile(app: string, path: string) {
  const { full, isRoot } = resolveFile(app, path);
  if (isRoot) throw new Error("The folder itself can't be deleted. Remove it from Persistent storage on the Overview instead.");
  rmSync(full, { recursive: true, force: true });
}

export function renameFile(app: string, from: string, to: string) {
  const a = resolveFile(app, from), b = resolveFile(app, to);
  if (a.isRoot || b.isRoot) throw new Error("A persistent folder itself can't be renamed.");
  if (existsSync(b.full)) throw new Error("Something with that name is already there.");
  renameSync(a.full, b.full);
}

// For downloads: the file as a stream.
export function streamFile(app: string, path: string) {
  const { full } = resolveFile(app, path);
  if (!statSync(full, { throwIfNoEntry: false })?.isFile()) throw new Error("File not found.");
  return Readable.toWeb(createReadStream(full)) as ReadableStream;
}
