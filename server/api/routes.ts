// All HTTP routes. Keep them thin: check input, call deploy/ or services/.
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "../lib/config.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { deploy } from "../deploy/index.ts";
import { extract } from "../deploy/extract.ts";
import { requireLogin, login, logout } from "./auth.ts";
import { apps } from "./apps.ts";
import { server } from "./server.ts";
import { git } from "./git.ts";
import { doctor } from "./doctor.ts";
import { agentPrompt } from "./agent.ts";
import { resolveName } from "../lib/db.ts";

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
app.get("/api/agent-prompt", agentPrompt);

app.get("/api/settings", (c) =>
  c.json({ token: config.token, dashboard: `https://${config.dashboardHost}`, baseDomain: config.baseDomain }),
);

// Upload a .tar.gz of the project. Response streams the build log.
app.post("/api/deploy/:name", async (c) => {
  // Follow renames: an old name from .deployboat.json still deploys the right app.
  const name = resolveName(c.req.param("name").toLowerCase());
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) {
    return c.json({ error: "App name: letters, numbers and dashes only." }, 400);
  }
  if (!c.req.raw.body) return c.json({ error: "No files uploaded." }, 400);
  if (isBusy(name)) return c.json({ error: `${name} is already deploying. Wait for it to finish.` }, 409);

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
      const url = await deploy(name, srcDir, (line) => out.writeln(line));
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
