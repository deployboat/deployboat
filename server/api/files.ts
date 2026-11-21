// The app's Files page: browse, edit, upload and delete files in its persistent folders.
// The path checks live in lib/files.ts. Agent tokens can't use these (see auth.ts):
// files can hold secrets.
import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { listFolder, readText, writeFile, makeFolder, removeFile, fileForDownload } from "../lib/files.ts";
import { DATA_DIR, extraFolders, dataUsage } from "../lib/appdata.ts";

export const files = new Hono();

// Wrap a handler so a thrown error becomes a friendly 400.
const safe = (fn: (c: any) => Promise<Response> | Response) => async (c: any) => {
  try { return await fn(c); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
};

// The folders, plus what's in one of them (?path=/data/uploads).
files.get("/:name/files", safe(async (c) => {
  const name = c.req.param("name");
  const path = c.req.query("path") || DATA_DIR;
  return c.json({ folders: [DATA_DIR, ...extraFolders(name)], path, entries: listFolder(name, path), usage: await dataUsage(name) });
}));

files.get("/:name/files/text", safe((c) => c.json(readText(c.req.param("name"), c.req.query("path") ?? ""))));

files.get("/:name/files/download", safe((c) => {
  const { full, name } = fileForDownload(c.req.param("name"), c.req.query("path") ?? "");
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${encodeURIComponent(name)}"` },
  });
}));

// Save a text file (new or edited).
files.put("/:name/files/text", safe(async (c) => {
  const { path, text } = await c.req.json<{ path: string; text: string }>();
  writeFile(c.req.param("name"), path, String(text ?? ""));
  return c.json({ ok: true });
}));

// Upload: the raw file is the body, its path is ?path=.
files.post("/:name/files/upload", safe(async (c) => {
  writeFile(c.req.param("name"), c.req.query("path") ?? "", new Uint8Array(await c.req.arrayBuffer()));
  return c.json({ ok: true });
}));

files.post("/:name/files/folder", safe(async (c) => {
  const { path } = await c.req.json<{ path: string }>();
  makeFolder(c.req.param("name"), path);
  return c.json({ ok: true });
}));

files.delete("/:name/files", safe((c) => {
  removeFile(c.req.param("name"), c.req.query("path") ?? "");
  return c.json({ ok: true });
}));
