// HTTP routes. Keep them thin: check input, call deploy/.
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { deploy, appUrl } from "../deploy/index.ts";
import { extract } from "../deploy/extract.ts";

export const app = new Hono();

app.get("/", (c) => c.text("Deploy Boat is running. Dashboard coming soon."));

// Every /api route needs the token.
app.use("/api/*", async (c, next) => {
  if (c.req.header("authorization") !== `Bearer ${config.token}`) {
    return c.json({ error: "Wrong or missing token. Run: deployboat login" }, 401);
  }
  await next();
});

app.get("/api/apps", (c) => {
  const apps = db.prepare("SELECT name FROM apps ORDER BY name").all() as { name: string }[];
  return c.json(apps.map((a) => ({ name: a.name, url: appUrl(a.name) })));
});

// Upload a .tar.gz of the project. Response streams the build log.
app.post("/api/deploy/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
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
