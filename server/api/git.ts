// New app from Git, deploy keys, redeploy. Deploys run in the background;
// the dashboard follows progress on the app's Versions page.
import { Hono } from "hono";
import { isBusy } from "../lib/lock.ts";
import { resolveName } from "../lib/db.ts";
import { ensureKey, saveRepo, validRepo, getGit, queueDeploy } from "../deploy/git.ts";

export const git = new Hono();

const validName = (n: string) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(n);

// The public key to add to a private repo.
git.post("/key", async (c) => {
  const { name } = await c.req.json().catch(() => ({}));
  if (!validName(name ?? "")) return c.json({ error: "Pick an app name first (letters, numbers, dashes)." }, 400);
  return c.json({ publicKey: await ensureKey(resolveName(name)) });
});

git.post("/deploy", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = resolveName(String(body.name ?? "").trim().toLowerCase());
  const repo = String(body.repo ?? "").trim();
  const branch = String(body.branch ?? "").trim() || "main";

  if (!validName(name)) return c.json({ error: "App name: letters, numbers and dashes only." }, 400);
  if (!validRepo(repo)) return c.json({ error: "That doesn't look like a Git URL. Example: https://github.com/you/project" }, 400);
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith("-")) return c.json({ error: "That branch name looks wrong." }, 400);
  if (isBusy(name)) return c.json({ error: `${name} is already deploying.` }, 409);

  saveRepo(name, repo, branch);
  queueDeploy(name, "→ Deploying from Git");
  return c.json({ ok: true, name });
});

// Pull the latest code and deploy again.
git.post("/redeploy/:name", (c) => {
  const name = c.req.param("name");
  if (!getGit(name)?.repo) return c.json({ error: "This app isn't connected to a Git repo." }, 400);
  if (isBusy(name)) return c.json({ error: `${name} is already deploying.` }, 409);
  queueDeploy(name, "→ Redeploy started from the dashboard");
  return c.json({ ok: true });
});
