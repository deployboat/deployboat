// MCP server: lets AI agents (Claude, Cursor…) use Deploy Boat as tools.
// Speaks JSON-RPC over stdin/stdout, one message per line. No dependencies.
// stdout is only for protocol messages; anything else goes to stderr.
import { createInterface } from "node:readline";
import { connection, appNameFor, api, resolveApp, deploy } from "./lib.js";

const VERSION = "0.2.0";

const TOOLS = [
  {
    name: "deploy",
    description: "Publish (or update) a project folder to the user's Deploy Boat server. Builds it automatically and returns the live URL, or the error and the end of the build log.",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "Absolute path of the project folder. Defaults to the current folder." },
      name: { type: "string", description: "App name (letters, numbers, dashes). Defaults to the name saved in .deployboat.json or the folder name." },
      services: { type: "array", items: { type: "string", enum: ["database", "mysql", "sqlite", "storage"] },
        description: "Add these on this deploy, only if the app needs them: database (PostgreSQL, DATABASE_URL), mysql or sqlite instead of PostgreSQL if the code expects that, storage (S3 file storage)." },
    } },
  },
  {
    name: "add_service",
    description: "Give an existing app a database (DATABASE_URL; 'database' is PostgreSQL, or 'mysql' / 'sqlite') or S3 file storage (S3_* variables). The app restarts. Only add what the app needs.",
    inputSchema: { type: "object", required: ["service"], properties: {
      service: { type: "string", enum: ["database", "mysql", "sqlite", "storage"] }, name: { type: "string" }, path: { type: "string" },
    } },
  },
  { name: "list_apps", description: "List the apps on the Deploy Boat server with their URLs and status.", inputSchema: { type: "object", properties: {} } },
  {
    name: "app_status",
    description: "Show an app's address, whether it's running, and its recent deploys.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, path: { type: "string", description: "Project folder, used to find the app name if `name` isn't given." } } },
  },
  {
    name: "get_logs",
    description: "Get an app's recent output (stdout/stderr). Use this to debug an app that crashes or misbehaves after deploying.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, path: { type: "string" }, lines: { type: "number", description: "How many lines (default 100)." } } },
  },
  {
    name: "set_env",
    description: "Set an environment variable for an app (e.g. an API key the user gave you). The app restarts to pick it up. Never put secrets in code.",
    inputSchema: { type: "object", required: ["key", "value"], properties: { name: { type: "string" }, path: { type: "string" }, key: { type: "string" }, value: { type: "string" } } },
  },
  {
    name: "unset_env",
    description: "Remove an environment variable from an app. The app restarts.",
    inputSchema: { type: "object", required: ["key"], properties: { name: { type: "string" }, path: { type: "string" }, key: { type: "string" } } },
  },
  {
    name: "setup_guide",
    description: "Read this before building or deploying: how apps must be written for Deploy Boat (port, database, file storage, secrets).",
    inputSchema: { type: "object", properties: {} },
  },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError && { isError: true }) });
const appOf = async (conn, a) => resolveApp(conn, a.name ?? appNameFor(a.path ?? ".", undefined));

async function callTool(name, a = {}) {
  const conn = connection();
  switch (name) {
    case "deploy": {
      const r = await deploy({ dir: a.path ?? ".", name: a.name, conn, services: Array.isArray(a.services) ? a.services : [] });
      return r.ok
        ? text(`Deployed "${r.app}". Live at ${r.url}\nShow this URL to the user.`)
        : text(`Deploy failed: ${r.error}\n\nLast build log lines:\n${r.log.slice(-40).join("\n")}\n\nFix the problem and deploy again.`, true);
    }
    case "add_service": {
      await api(conn, `/api/apps/${await appOf(conn, a)}/services/${a.service}`, { method: "POST" });
      return text({
        database: "PostgreSQL database added. The app now has DATABASE_URL and has restarted.",
        mysql: "MySQL database added. The app now has DATABASE_URL (mysql://…) and has restarted.",
        sqlite: "SQLite database added. The app now has DATABASE_URL (file:/data/app.db) and SQLITE_PATH, and has restarted.",
        storage: "File storage added. The app now has S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION and S3_PUBLIC_URL, and has restarted.",
      }[a.service] ?? "Added.");
    }
    case "list_apps": {
      const list = await api(conn, "/api/apps");
      return text(list.length ? list.map((x) => `${x.name}: ${x.url} (${x.building ? "building" : x.stopped ? "stopped" : x.state})`).join("\n") : "No apps yet.");
    }
    case "app_status": {
      const x = await api(conn, `/api/apps/${await appOf(conn, a)}`);
      const deploys = x.deploys.slice(0, 5).map((d) => `#${d.id} ${d.status} ${d.created_at} UTC${d.current ? " (running)" : ""}`).join("\n");
      return text(`${x.name}\nURL: ${x.url}\nState: ${x.building ? "building" : x.stopped ? "stopped" : x.state}\nRecent deploys:\n${deploys || "none"}`);
    }
    case "get_logs": {
      const logs = await api(conn, `/api/apps/${await appOf(conn, a)}/logs?lines=${Math.min(Number(a.lines) || 100, 1000)}`);
      return text(logs || "No output yet.");
    }
    case "set_env": {
      await api(conn, `/api/apps/${await appOf(conn, a)}/env`, { method: "PUT", body: { key: a.key, value: a.value } });
      return text(`Saved ${a.key}. The app restarted.`);
    }
    case "unset_env": {
      await api(conn, `/api/apps/${await appOf(conn, a)}/env/${encodeURIComponent(a.key)}`, { method: "DELETE" });
      return text(`Removed ${a.key}. The app restarted.`);
    }
    case "setup_guide":
      return text(await api(conn, "/api/agent-guide"));
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "deployboat", version: VERSION },
        instructions: "Deploy Boat publishes projects to the user's own server. Call setup_guide before building an app, then deploy. Apps can add a PostgreSQL database and S3 file storage when they need them.",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      try { return await callTool(msg.params?.name, msg.params?.arguments); }
      catch (e) { if (e.code) throw e; return text(e.message, true); }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (msg.id === undefined) return; // notifications need no answer
  try { send({ jsonrpc: "2.0", id: msg.id, result: await handle(msg) }); }
  catch (e) { send({ jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32603, message: e.message } }); }
});
