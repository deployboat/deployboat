// Shared by the CLI commands and the MCP server: settings, API calls, deploy.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";

const globalDir = join(homedir(), ".deployboat");
const globalFile = join(globalDir, "config.json");

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } };

export function saveLogin(server, token) {
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(globalFile, JSON.stringify({ server: server.replace(/\/$/, ""), token }, null, 2), { mode: 0o600 });
}

// Server + token from (in order) flags, env vars, or `deployboat login`.
export function connection(flags = {}) {
  const saved = readJson(globalFile);
  const server = (flags.server ?? process.env.DEPLOYBOAT_URL ?? saved.server)?.replace(/\/$/, "");
  const token = flags.token ?? process.env.DEPLOYBOAT_TOKEN ?? saved.token;
  if (!server || !token) throw new Error("Not connected to a Deploy Boat server. Run: deployboat login <server-url> <token>");
  return { server, token };
}

// Which app a folder belongs to: .deployboat.json, or the folder name.
export function appNameFor(dir, override) {
  if (override) return override;
  const saved = readJson(join(dir, ".deployboat.json")).name;
  return saved ?? basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
const rememberName = (dir, name) => writeFileSync(join(dir, ".deployboat.json"), JSON.stringify({ name }, null, 2) + "\n");

// Call the server API. Throws with the server's own message on errors.
export async function api(conn, path, { method = "GET", body } = {}) {
  const res = await fetch(`${conn.server}${path}`, {
    method,
    headers: { authorization: `Bearer ${conn.token}`, ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
  }).catch((e) => { throw new Error(`Can't reach ${conn.server} (${e.cause?.code ?? e.message})`); });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data?.error ?? `Server error ${res.status}`);
  return data;
}

// Follow renames: an old name from .deployboat.json still finds the app.
export const resolveApp = async (conn, name) => (await api(conn, `/api/resolve/${encodeURIComponent(name)}`)).name;

// Upload a folder and build it. `onLine` gets each build log line.
// `services` adds a database and/or storage on this deploy, e.g. ["database"].
// Returns { ok, app, url, error, log } — never throws for build failures.
export async function deploy({ dir = ".", name, conn, services = [], onLine = () => {} }) {
  dir = resolve(dir);
  if (!existsSync(dir)) return { ok: false, error: `Folder not found: ${dir}`, log: [] };
  const app = appNameFor(dir, name);
  rememberName(dir, app);

  const tar = spawn("tar", ["-cz", "--exclude=node_modules", "--exclude=.git", "--exclude=.env", "-f", "-", "."], { cwd: dir });
  let res;
  try {
    const query = services.length ? `?with=${encodeURIComponent(services.join(","))}` : "";
    res = await fetch(`${conn.server}/api/deploy/${app}${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${conn.token}`, "content-type": "application/gzip" },
      body: Readable.toWeb(tar.stdout),
      duplex: "half",
    });
  } catch (e) {
    return { ok: false, app, error: `Can't reach ${conn.server} (${e.cause?.code ?? e.message})`, log: [] };
  }
  if (!res.ok) return { ok: false, app, error: (await res.json().catch(() => ({}))).error ?? `Server error ${res.status}`, log: [] };

  // The app may have been renamed in the dashboard. Remember the new name.
  const current = res.headers.get("x-app-name") ?? app;
  if (current !== app) rememberName(dir, current);

  // Stream the build log. The last line is "LIVE <url>" or "FAILED <reason>".
  const log = [];
  let url = null, error = null, buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("LIVE ")) url = line.slice(5);
      else if (line.startsWith("FAILED ")) error = line.slice(7);
      else { log.push(line); onLine(line); }
    }
  }
  if (!url && !error) error = "The connection closed before the deploy finished.";
  return { ok: !!url, app: current, url, error, log };
}
