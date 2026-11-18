#!/usr/bin/env node
// Deploy Boat CLI. Plain JavaScript, no dependencies, so `npx deployboat` is instant.
//
//   deployboat login <server-url> <token>
//   deployboat deploy [--name my-app]
//
// Server and token can also come from DEPLOYBOAT_URL / DEPLOYBOAT_TOKEN or --server / --token.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";

const globalFile = join(homedir(), ".deployboat", "config.json");
const projectFile = ".deployboat.json"; // remembers the app name per project

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "login") {
  const [server, token] = args;
  if (!server || !token) die("Usage: deployboat login <server-url> <token>");
  mkdirSync(join(homedir(), ".deployboat"), { recursive: true });
  writeFileSync(globalFile, JSON.stringify({ server: server.replace(/\/$/, ""), token }, null, 2), { mode: 0o600 });
  console.log("✓ Logged in. Now run: deployboat deploy");
} else if (cmd === "deploy") {
  await deploy();
} else {
  console.log("Usage:\n  deployboat login <server-url> <token>\n  deployboat deploy [--name my-app]");
}

async function deploy() {
  const saved = readJson(globalFile);
  const server = flag("server") ?? process.env.DEPLOYBOAT_URL ?? saved.server;
  const token = flag("token") ?? process.env.DEPLOYBOAT_TOKEN ?? saved.token;
  if (!server || !token) die("Not logged in. Run: deployboat login <server-url> <token>");

  const project = readJson(projectFile);
  const name = flag("name") ?? project.name ??
    basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  writeFileSync(projectFile, JSON.stringify({ name }, null, 2));

  console.log(`→ Uploading ${name}…`);
  const tar = spawn("tar", ["-cz", "--exclude=node_modules", "--exclude=.git", "--exclude=.env", "-f", "-", "."]);

  const res = await fetch(`${server}/api/deploy/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/gzip" },
    body: Readable.toWeb(tar.stdout),
    duplex: "half",
  }).catch((e) => die(`Can't reach ${server} (${e.cause?.code ?? e.message})`));

  if (!res.ok) die((await res.json().catch(() => ({}))).error ?? `Server error ${res.status}`);

  // Stream the build log. Last line is "LIVE <url>" or "FAILED <reason>".
  let ok = false, buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("LIVE ")) { ok = true; console.log(`\n✓ Live: ${line.slice(5)}`); }
      else if (line.startsWith("FAILED ")) console.error(`\n✗ Deploy failed: ${line.slice(7)}`);
      else console.log(`  ${line}`);
    }
  }
  process.exit(ok ? 0 : 1);
}
