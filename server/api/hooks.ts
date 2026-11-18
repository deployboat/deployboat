// Webhooks from GitHub, GitLab, Bitbucket and Gitea: deploy on push, previews for PRs.
// No login: the secret in the address proves the call is for this app.
import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { resolveName } from "../lib/db.ts";
import { getGit, queueDeploy } from "../deploy/git.ts";
import { deployPreview, removePreview } from "../deploy/previews.ts";

export const hooks = new Hono();

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const short = (sha?: string) => (sha ?? "").slice(0, 7);
const firstLine = (s?: string) => (s ?? "").split("\n")[0].slice(0, 80);

hooks.post("/:app/:secret", async (c) => {
  const app = resolveName(c.req.param("app"));
  const row = getGit(app);
  if (!row?.repo || !row.webhook_secret || !same(c.req.param("secret"), row.webhook_secret)) {
    return c.json({ error: "Unknown webhook." }, 404);
  }

  // GitHub can send JSON or a form with a "payload" field.
  const type = c.req.header("content-type") ?? "";
  let body: any = {};
  try {
    body = type.includes("form") ? JSON.parse(String((await c.req.parseBody()).payload ?? "{}")) : await c.req.json();
  } catch { return c.json({ error: "Couldn't read the webhook body." }, 400); }

  const gh = c.req.header("x-github-event") ?? c.req.header("x-gitea-event") ?? c.req.header("x-gogs-event");
  const gl = c.req.header("x-gitlab-event");
  const bb = c.req.header("x-event-key");
  const done = (result: string) => c.json({ ok: true, result });

  if (gh === "ping") return done("pong");

  // --- push -------------------------------------------------------------------
  let pushedBranch: string | undefined, commit = "", author = "", message = "";
  if (gh === "push" || gl === "Push Hook") {
    pushedBranch = String(body.ref ?? "").replace(/^refs\/heads\//, "");
    const head = body.head_commit ?? body.commits?.at(-1) ?? {};
    commit = short(head.id ?? body.checkout_sha ?? body.after);
    author = head.author?.name ?? body.user_name ?? body.pusher?.name ?? "";
    message = firstLine(head.message);
  } else if (bb === "repo:push") {
    const change = body.push?.changes?.at(-1)?.new;
    pushedBranch = change?.type === "branch" ? change.name : undefined;
    commit = short(change?.target?.hash);
    author = change?.target?.author?.user?.display_name ?? "";
    message = firstLine(change?.target?.message);
  }
  if (pushedBranch !== undefined) {
    if (pushedBranch !== row.branch) return done(`ignored: push to ${pushedBranch}, this app follows ${row.branch}`);
    if (!row.auto_deploy) return done("ignored: auto-deploy is off");
    const why = `→ Push to ${pushedBranch}: ${commit}${message ? ` "${message}"` : ""}${author ? ` by ${author}` : ""}`;
    return done(queueDeploy(app, why));
  }

  // --- pull requests (GitHub, Gitea) / merge requests (GitLab) --------------------
  let pr: { n: number; action: "deploy" | "close"; ref: string; fromFork: boolean; title: string } | null = null;
  if (gh === "pull_request" && body.pull_request) {
    const p = body.pull_request;
    const action = ["opened", "reopened", "synchronize", "synchronized"].includes(body.action) ? "deploy" : body.action === "closed" ? "close" : null;
    if (action) pr = { n: p.number, action, ref: `refs/pull/${p.number}/head`, title: p.title ?? "",
      fromFork: (p.head?.repo?.full_name ?? "") !== (p.base?.repo?.full_name ?? "") };
  } else if (gl === "Merge Request Hook" && body.object_attributes) {
    const m = body.object_attributes;
    const action = ["open", "reopen", "update"].includes(m.action) ? "deploy" : ["close", "merge"].includes(m.action) ? "close" : null;
    if (action) pr = { n: m.iid, action, ref: `refs/merge-requests/${m.iid}/head`, title: m.title ?? "",
      fromFork: m.source_project_id !== m.target_project_id };
  }
  if (pr) {
    if (pr.action === "close") return done((await removePreview(app, pr.n)) ? `preview for #${pr.n} deleted` : "no preview to delete");
    if (!row.previews) return done("ignored: previews are off");
    // Code from forks could be anyone's: never run it on this server.
    if (pr.fromFork) return done("ignored: pull request from a fork");
    return done(await deployPreview(app, pr.n, pr.ref, `→ Preview for #${pr.n}: ${firstLine(pr.title)}`));
  }

  return done("ignored: not a push or pull request");
});
