#!/usr/bin/env node
// Deploy Boat CLI. Plain JavaScript, no dependencies, so `npx deployboat` is instant.
// Run `deployboat help` for all commands.
import { saveLogin, connection, appNameFor, api, resolveApp, deploy } from "./lib.js";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(`--${n}`);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1]?.startsWith("--") && !["--json"].includes(argv[i - 1])));
const [cmd, ...args] = positional;
const json = has("json");

const out = (data, text) => console.log(json ? JSON.stringify(data) : text);
function fail(msg) {
  if (json) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`✗ ${msg}`);
  process.exit(1);
}

const HELP = `Deploy Boat — publish any project to your own server.

  deployboat login <server-url> <token>   connect this computer (once)
  deployboat deploy [folder]              publish a folder (default: this one)
             [--with database,storage]    …and add services (database, storage, email)
  deployboat add database|storage|email   add a database, file storage or email to this app
  deployboat apps                         list your apps
  deployboat status                       this app's status and address
  deployboat logs [--lines 100]           this app's recent output
  deployboat env list                     this app's variables
  deployboat env set KEY=value …          add or change variables (restarts the app)
  deployboat env unset KEY …              remove variables (restarts the app)
  deployboat mcp                          run as an MCP server for AI agents

Options:
  --name <app>        use this app instead of the one for this folder
  --json              print machine-readable JSON (for scripts and AI agents)
  --server, --token   connect without logging in (or DEPLOYBOAT_URL / DEPLOYBOAT_TOKEN)`;

try {
  const conn = () => connection({ server: flag("server"), token: flag("token") });
  const app = async () => resolveApp(conn(), appNameFor(".", flag("name")));

  switch (cmd) {
    case "login": {
      const [server, token] = args;
      if (!server || !token) fail("Usage: deployboat login <server-url> <token>");
      saveLogin(server, token);
      await api({ server: server.replace(/\/$/, ""), token }, "/api/apps"); // check it works
      out({ ok: true }, "✓ Connected. Now run: deployboat deploy");
      break;
    }

    case "deploy": {
      if (!json) console.log("→ Uploading…");
      const services = (flag("with") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const r = await deploy({ dir: args[0] ?? ".", name: flag("name"), conn: conn(), services, onLine: json ? undefined : (l) => console.log(`  ${l}`) });
      if (json) console.log(JSON.stringify({ ...r, log: r.log.slice(-40) }));
      else if (r.ok) console.log(`\n✓ Live: ${r.url}`);
      else console.error(`\n✗ Deploy failed: ${r.error}`);
      process.exit(r.ok ? 0 : 1);
    }

    case "add": {
      const service = args[0];
      if (!["database", "storage", "email"].includes(service)) fail("Usage: deployboat add database   (or: add storage, add email)");
      const r = await api(conn(), `/api/apps/${await app()}/services/${service}`, { method: "POST" });
      out(r, `✓ ${{ database: "Database", storage: "File storage", email: "Email" }[service]} added. The app restarted with the new variables.`);
      break;
    }

    case "apps": {
      const list = await api(conn(), "/api/apps");
      out(list, list.length ? list.map((a) => `${a.name.padEnd(24)} ${a.url}`).join("\n") : "No apps yet.");
      break;
    }

    case "status": {
      const a = await api(conn(), `/api/apps/${await app()}`);
      const state = a.building ? "building" : a.stopped ? "stopped" : a.state;
      out({ name: a.name, url: a.url, state, lastDeploy: a.deploys[0] ?? null },
        `${a.displayName}\n  address: ${a.url}\n  state:   ${state}\n  last deploy: ${a.deploys[0]?.status ?? "none"} (${a.deploys[0]?.created_at ?? "never"} UTC)`);
      break;
    }

    case "logs": {
      const text = await api(conn(), `/api/apps/${await app()}/logs?lines=${Number(flag("lines")) || 100}`);
      out({ logs: text }, text || "No output yet.");
      break;
    }

    case "env": {
      const [action, ...pairs] = args;
      const base = `/api/apps/${await app()}/env`;
      if (action === "set") {
        if (!pairs.length) fail("Usage: deployboat env set KEY=value");
        for (const p of pairs) {
          const i = p.indexOf("=");
          if (i < 1) fail(`"${p}" should look like KEY=value`);
          await api(conn(), base, { method: "PUT", body: { key: p.slice(0, i), value: p.slice(i + 1) } });
        }
        out({ ok: true }, `✓ Saved ${pairs.length} variable${pairs.length === 1 ? "" : "s"}. The app restarted.`);
      } else if (action === "unset") {
        for (const k of pairs) await api(conn(), `${base}/${encodeURIComponent(k)}`, { method: "DELETE" });
        out({ ok: true }, `✓ Removed. The app restarted.`);
      } else {
        // Values are hidden unless you ask for them: they're often secrets.
        const vars = await api(conn(), base);
        out(vars.map(({ key, builtin }) => ({ key, builtin })),
          vars.map((v) => `${v.key}${v.builtin ? "  (built-in)" : ""}`).join("\n") || "No variables.");
      }
      break;
    }

    case "mcp":
      await import("./mcp.js");
      break;

    default:
      console.log(HELP);
  }
} catch (e) {
  fail(e.message);
}
