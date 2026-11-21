// The app's Files page: browse, edit, upload, rename and delete files.
//
// While the app runs, it sees everything inside its container (lib/files-container.ts).
// When it's stopped, or its image has no shell, only the persistent folders, straight
// from the server's disk (lib/files-saved.ts). Both have the same functions.
//
// Agent tokens can't use these (see auth.ts): files can hold secrets.
import { Hono } from "hono";
import * as inContainer from "../lib/files-container.ts";
import * as saved from "../lib/files-saved.ts";
import { containerState } from "../deploy/manage.ts";
import { DATA_DIR, extraFolders } from "../lib/appdata.ts";

export const files = new Hono();

const MAX_EDIT = 2 * 1024 * 1024; // bigger files can be downloaded, not edited here

// Which way to reach the files. Tries the container first, checks it has a shell.
async function source(app: string) {
  if ((await containerState(app)) === "running") {
    if (await inContainer.hasShell(app)) return { fs: inContainer, live: true, why: null };
    return { fs: saved, live: false, why: "This app's image has no shell, so only its persistent folders can be shown." };
  }
  return { fs: saved, live: false, why: "The app isn't running, so only its persistent folders are shown. Start it to see every file." };
}

// Wrap a handler so a thrown error becomes a friendly 400.
const safe = (fn: (c: any, app: string) => Promise<Response>) => async (c: any) => {
  try { return await fn(c, c.req.param("name")); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
};

// What's in a folder (?path=), plus what the page needs to draw itself.
files.get("/:name/files", safe(async (c, app) => {
  const { fs, live, why } = await source(app);
  const folders = [DATA_DIR, ...extraFolders(app)]; // persistent ones
  const home = live ? await inContainer.workDir(app) : DATA_DIR;
  const path = c.req.query("path") || home;
  return c.json({ live, why, home, folders, path, entries: await fs.listFolder(app, path) });
}));

// A file, for the editor: its text, or why it can't be edited here.
files.get("/:name/files/text", safe(async (c, app) => {
  const { fs } = await source(app);
  try {
    const buf = await fs.readFile(app, c.req.query("path") ?? "", MAX_EDIT);
    if (buf.includes(0)) return c.json({ text: null, reason: "This isn't a text file. Download it to open it." });
    return c.json({ text: buf.toString("utf8"), reason: null });
  } catch (e) {
    if ((e as Error).message === "too big") return c.json({ text: null, reason: "This file is bigger than 2 MB. Download it to open it." });
    throw e;
  }
}));

files.get("/:name/files/download", safe(async (c, app) => {
  const { fs } = await source(app);
  const path = c.req.query("path") ?? "";
  const name = path.split("/").pop() || "file";
  return new Response(await fs.streamFile(app, path), {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
}));

// Save a text file (new or edited).
files.put("/:name/files/text", safe(async (c, app) => {
  const { fs } = await source(app);
  const { path, text } = await c.req.json();
  await fs.writeFile(app, path, new TextEncoder().encode(String(text ?? "")));
  return c.json({ ok: true });
}));

// Upload: the raw file is the body, its full path is ?path=.
files.post("/:name/files/upload", safe(async (c, app) => {
  const { fs } = await source(app);
  await fs.writeFile(app, c.req.query("path") ?? "", new Uint8Array(await c.req.arrayBuffer()));
  return c.json({ ok: true });
}));

files.post("/:name/files/folder", safe(async (c, app) => {
  const { fs } = await source(app);
  await fs.makeFolder(app, (await c.req.json()).path);
  return c.json({ ok: true });
}));

files.post("/:name/files/rename", safe(async (c, app) => {
  const { fs } = await source(app);
  const { from, to } = await c.req.json();
  await fs.renameFile(app, from, to);
  return c.json({ ok: true });
}));

files.delete("/:name/files", safe(async (c, app) => {
  const { fs } = await source(app);
  await fs.removeFile(app, c.req.query("path") ?? "");
  return c.json({ ok: true });
}));
