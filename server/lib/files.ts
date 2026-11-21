// The file browser behind the app's Files page.
//
// It shows the app's persistent folders (see appdata.ts): /data and any extra ones.
// Paths are the ones the app sees, like "/data/uploads/a.png". We turn them into a path
// on the server and make sure it stays inside one of the folders, so "../" or a symlink
// can't reach anything else on the server.
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { mounts } from "./appdata.ts";

const MAX_EDIT = 1024 * 1024; // files bigger than 1 MB can be downloaded, not edited here

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

export type Entry = { name: string; dir: boolean; size: number; modified: string };

export function listFolder(app: string, path: string): Entry[] {
  const { full } = resolveFile(app, path);
  if (!existsSync(full) || !statSync(full).isDirectory()) throw new Error("Folder not found.");
  return readdirSync(full, { withFileTypes: true })
    .map((d) => {
      const st = statSync(join(full, d.name), { throwIfNoEntry: false });
      return { name: d.name, dir: !!st?.isDirectory(), size: st?.size ?? 0, modified: st?.mtime.toISOString().replace("T", " ").slice(0, 19) ?? "" /* same format as the database */ };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

// A text file's content, or why it can't be shown.
export function readText(app: string, path: string) {
  const { full } = resolveFile(app, path);
  const st = statSync(full, { throwIfNoEntry: false });
  if (!st?.isFile()) throw new Error("File not found.");
  if (st.size > MAX_EDIT) return { text: null, reason: "This file is bigger than 1 MB. Download it instead." };
  const buf = readFileSync(full);
  if (buf.includes(0)) return { text: null, reason: "This isn't a text file. Download it instead." };
  return { text: buf.toString("utf8"), reason: null };
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
  if (isRoot) throw new Error("The folder itself can't be deleted. Remove it from Persistent storage instead.");
  rmSync(full, { recursive: true, force: true });
}

// For downloads: the server path and a file name.
export function fileForDownload(app: string, path: string) {
  const { full } = resolveFile(app, path);
  if (!statSync(full, { throwIfNoEntry: false })?.isFile()) throw new Error("File not found.");
  return { full, name: basename(full) };
}
