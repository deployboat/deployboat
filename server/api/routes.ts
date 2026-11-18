// All HTTP routes. Keep them thin: check input, call deploy/ or services/.
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { config, resetMainToken } from "../lib/config.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { deploy } from "../deploy/index.ts";
import { extract } from "../deploy/extract.ts";
import { requireLogin, login, logout, setLoginCookie } from "./auth.ts";
import { tokens } from "./tokens.ts";
import { apps } from "./apps.ts";
import { server } from "./server.ts";
import { git } from "./git.ts";
import { doctor } from "./doctor.ts";
import { backups } from "./backups.ts";
import { agentPrompt, agentGuide } from "./agent.ts";
import { resolveName, db } from "../lib/db.ts";
import { isService } from "../services/index.ts";

export const app = new Hono();

// Login (no token needed for these two).
app.post("/auth/login", login);
app.post("/auth/logout", logout);

// Everything under /api needs the token.
app.use("/api/*", requireLogin);
app.route("/api/apps", apps);
app.route("/api/server", server);
app.route("/api/git", git);
app.route("/api/doctor", doctor);
app.route("/api/backups", backups);
app.route("/api/tokens", tokens);
app.get("/api/agent-prompt", agentPrompt);
app.get("/api/agent-guide", agentGuide);
// Old app name → current name (after a rename). 404 if there's no such app.
app.get("/api/resolve/:name", (c) => {
  const name = resolveName(c.req.param("name").toLowerCase());
  return db.prepare("SELECT 1 FROM apps WHERE name = ?").get(name) ? c.json({ name }) : c.json({ error: `No app called "${name}" yet. Deploy it first.` }, 404);
});

app.get("/api/settings", (c) =>
  c.json({ token: config.token, dashboard: `https://${config.dashboardHost}`, baseDomain: config.baseDomain }),
);

// New main token. Other browsers and anything using the old token are logged out.
// Agent tokens keep working. (Agent tokens can't call this: see api/auth.ts.)
app.post("/api/settings/reset-token", (c) => {
  resetMainToken();
  setLoginCookie(c); // keep *this* browser logged in
  return c.json({ token: config.token });
});

// Upload a .tar.gz of the project. Response streams the build log.
app.post("/api/deploy/:name", async (c) => {
  // Follow renames: an old name from .deployboat.json still deploys the right app.
  const name = resolveName(c.req.param("name").toLowerCase());
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) {
    return c.json({ error: "App name: letters, numbers and dashes only." }, 400);
  }
  if (!c.req.raw.body) return c.json({ error: "No files uploaded." }, 400);
  if (isBusy(name)) return c.json({ error: `${name} is already deploying. Wait for it to finish.` }, 409);

  // ?with=database,storage adds those services on this deploy.
  const add = (c.req.query("with") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const bad = add.find((x) => !isService(x));
  if (bad) return c.json({ error: `Unknown service "${bad}". Use database or storage.` }, 400);

  lock(name);
  let srcDir: string;
  try {
    srcDir = await extract(name, c.req.raw.body);
  } catch (e) {
    unlock(name);
    return c.json({ error: (e as Error).message }, 400);
  }

  c.header("x-app-name", name); // lets the CLI update .deployboat.json after a rename
  return streamText(c, async (out) => {
    try {
      const url = await deploy(name, srcDir, (line) => out.writeln(line), add as any);
      await out.writeln(`LIVE ${url}`);
    } catch (e) {
      await out.writeln(`FAILED ${(e as Error).message}`);
    } finally {
      unlock(name);
    }
  });
});

// Dashboard: plain files from web/. Unknown paths fall back to index.html.
app.use("/*", serveStatic({ root: "./web" }));
app.get("*", serveStatic({ path: "./web/index.html" }));
