// Deploy from a Git repo. Public repos just work. Private repos use a deploy key:
// the server makes an SSH key per app, and you add the public half to the repo.
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { run } from "../lib/shell.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { deploy } from "./index.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS git (
    app         TEXT PRIMARY KEY,
    repo        TEXT,
    branch      TEXT DEFAULT 'main',
    private_key TEXT,
    public_key  TEXT
  );
`);
// Added later: auto-deploy (webhook), PR previews, and which ref to build (previews build a PR).
for (const col of ["webhook_secret TEXT", "auto_deploy INTEGER DEFAULT 1", "previews INTEGER DEFAULT 0", "ref TEXT"]) {
  try { db.exec(`ALTER TABLE git ADD COLUMN ${col}`); } catch { /* already there */ }
}

export type GitRow = {
  app: string; repo: string | null; branch: string; private_key: string | null; public_key: string | null;
  webhook_secret: string | null; auto_deploy: number; previews: number; ref: string | null;
};
export const getGit = (app: string) => db.prepare("SELECT * FROM git WHERE app = ?").get(app) as GitRow | undefined;

// https://github.com/me/repo, git@github.com:me/repo.git, ssh://… — nothing that looks like a flag.
export const validRepo = (url: string) =>
  /^(https:\/\/|ssh:\/\/|git@)[\w.@:\/~+-]+$/.test(url) && !url.startsWith("-");

// Make (once) and return the app's public deploy key.
export async function ensureKey(app: string): Promise<string> {
  const row = getGit(app);
  if (row?.public_key) return row.public_key;

  const dir = mkdtempSync(join(tmpdir(), "dbkey-"));
  try {
    await run("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", `deployboat-${app}`, "-f", join(dir, "key")]);
    const priv = readFileSync(join(dir, "key"), "utf8");
    const pub = readFileSync(join(dir, "key.pub"), "utf8").trim();
    db.prepare(`INSERT INTO git (app, private_key, public_key) VALUES (?, ?, ?)
      ON CONFLICT(app) DO UPDATE SET private_key = excluded.private_key, public_key = excluded.public_key`).run(app, priv, pub);
    return pub;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function saveRepo(app: string, repo: string, branch: string) {
  db.prepare(`INSERT INTO git (app, repo, branch, webhook_secret) VALUES (?, ?, ?, ?)
    ON CONFLICT(app) DO UPDATE SET repo = excluded.repo, branch = excluded.branch,
      webhook_secret = COALESCE(git.webhook_secret, excluded.webhook_secret)`).run(app, repo, branch, newSecret());
}

const newSecret = () => randomBytes(20).toString("hex");

// The secret part of the app's webhook address. Made on first use.
export function webhookSecret(app: string) {
  const row = getGit(app);
  if (row?.webhook_secret) return row.webhook_secret;
  const secret = newSecret();
  db.prepare("UPDATE git SET webhook_secret = ? WHERE app = ?").run(secret, app);
  return secret;
}

export function setGitOptions(app: string, opts: { autoDeploy?: boolean; previews?: boolean; resetSecret?: boolean }) {
  if (opts.autoDeploy !== undefined) db.prepare("UPDATE git SET auto_deploy = ? WHERE app = ?").run(opts.autoDeploy ? 1 : 0, app);
  if (opts.previews !== undefined) db.prepare("UPDATE git SET previews = ? WHERE app = ?").run(opts.previews ? 1 : 0, app);
  if (opts.resetSecret) db.prepare("UPDATE git SET webhook_secret = ? WHERE app = ?").run(newSecret(), app);
}

// https://host/owner/repo → git@host:owner/repo.git (so the deploy key can be used)
const toSsh = (url: string) => {
  const m = url.match(/^https:\/\/([^/]+)\/(.+?)(\.git)?\/?$/);
  return m ? `git@${m[1]}:${m[2]}.git` : url;
};

function git(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("git", args, { env });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve(e.message));
    p.on("close", (code) => resolve(code === 0 ? "" : err.trim() || "git failed"));
  });
}

// Get one ref (a branch, or a PR like refs/pull/12/head) without the full history.
// Returns "" on success, or git's error message.
async function fetchRef(url: string, ref: string, dir: string, keyFile?: string): Promise<string> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0", // never wait for a password
    ...(keyFile && { GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` }),
  };
  return (await git(["-C", dir, "init", "-q"], env))
    || (await git(["-C", dir, "fetch", "-q", "--depth", "1", "--", url, ref], env))
    || (await git(["-C", dir, "checkout", "-q", "FETCH_HEAD"], env));
}

// Download the code into the app's source folder. Returns that folder.
export async function fetchSource(app: string, log: (l: string) => void, setCommit: (c: string) => void = () => {}): Promise<string> {
  const row = getGit(app);
  if (!row?.repo) throw new Error("This app isn't connected to a Git repo.");
  const ref = row.ref ?? row.branch;
  const dir = join(config.dataDir, "apps", app, "src");
  mkdirSync(join(config.dataDir, "apps", app), { recursive: true });

  log(`→ Downloading ${row.repo} (${ref.replace(/^refs\/(pull|merge-requests)\/(\d+)\/head$/, "#$2")})…`);
  let error = await fetchRef(row.repo, ref, dir);

  // Didn't work? If there's a deploy key, try again over SSH with it.
  if (error && row.private_key) {
    const keyFile = join(config.dataDir, "apps", app, "deploy_key");
    writeFileSync(keyFile, row.private_key, { mode: 0o600 });
    try { error = await fetchRef(toSsh(row.repo), ref, dir, keyFile); }
    finally { rmSync(keyFile, { force: true }); }
  }

  if (error) {
    log(error);
    throw new Error(
      /not found|could not read|denied|authentication/i.test(error)
        ? "Couldn't access the repo. If it's private, add the deploy key to the repo (Settings → Deploy keys) and try again."
        : /couldn't find remote ref|remote ref|branch/i.test(error)
          ? `"${ref}" doesn't exist in this repo.`
          : "Couldn't download the repo. Check the URL and try again.",
    );
  }
  // Remember which commit this is ("a1b2c3d Fix login"), for the Versions page.
  const commit = await run("git", ["-C", dir, "log", "-1", "--format=%h %s"]).catch(() => "");
  if (commit) { setCommit(commit.slice(0, 200)); log(`→ Commit ${commit}`); }
  rmSync(join(dir, ".git"), { recursive: true, force: true }); // the build doesn't need it
  return dir;
}

// --- deploy queue ----------------------------------------------------------------
// Pushes can arrive while a deploy is running. Then we deploy once more afterwards,
// with whatever is newest. Several pushes during one deploy → just one more deploy.
const queued = new Map<string, string>(); // app → why

export function queueDeploy(app: string, reason: string) {
  if (isBusy(app)) { queued.set(app, reason); return "queued" as const; }
  lock(app);
  deploy(app, async (log, setCommit) => { log(reason); return fetchSource(app, log, setCommit); }, undefined, [], reason.replace(/^→ /, ""))
    .catch(() => {}) // the error is already in the deploy log
    .finally(() => {
      unlock(app);
      const next = queued.get(app);
      if (next) { queued.delete(app); queueDeploy(app, next); }
    });
  return "started" as const;
}
