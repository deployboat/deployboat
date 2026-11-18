// Deploy from a Git repo. Public repos just work. Private repos use a deploy key:
// the server makes an SSH key per app, and you add the public half to the repo.
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { run } from "../lib/shell.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS git (
    app         TEXT PRIMARY KEY,
    repo        TEXT,
    branch      TEXT DEFAULT 'main',
    private_key TEXT,
    public_key  TEXT
  );
`);

type GitRow = { app: string; repo: string | null; branch: string; private_key: string | null; public_key: string | null };
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
  db.prepare(`INSERT INTO git (app, repo, branch) VALUES (?, ?, ?)
    ON CONFLICT(app) DO UPDATE SET repo = excluded.repo, branch = excluded.branch`).run(app, repo, branch);
}

// https://host/owner/repo → git@host:owner/repo.git (so the deploy key can be used)
const toSsh = (url: string) => {
  const m = url.match(/^https:\/\/([^/]+)\/(.+?)(\.git)?\/?$/);
  return m ? `git@${m[1]}:${m[2]}.git` : url;
};

function clone(url: string, branch: string, dir: string, keyFile?: string): Promise<string> {
  return new Promise((resolve) => {
    rmSync(dir, { recursive: true, force: true });
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0", // never wait for a password
      ...(keyFile && { GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` }),
    };
    const git = spawn("git", ["clone", "--depth", "1", "--branch", branch, "--", url, dir], { env });
    let err = "";
    git.stderr.on("data", (d) => (err += d));
    git.on("close", (code) => resolve(code === 0 ? "" : err.trim() || "git clone failed"));
  });
}

// Download the code into the app's source folder. Returns that folder.
export async function fetchSource(app: string, log: (l: string) => void): Promise<string> {
  const row = getGit(app);
  if (!row?.repo) throw new Error("This app isn't connected to a Git repo.");
  const dir = join(config.dataDir, "apps", app, "src");
  mkdirSync(join(config.dataDir, "apps", app), { recursive: true });

  log(`→ Downloading ${row.repo} (${row.branch})…`);
  let error = await clone(row.repo, row.branch, dir);

  // Didn't work? If there's a deploy key, try again over SSH with it.
  if (error && row.private_key) {
    const keyFile = join(config.dataDir, "apps", app, "deploy_key");
    writeFileSync(keyFile, row.private_key, { mode: 0o600 });
    try { error = await clone(toSsh(row.repo), row.branch, dir, keyFile); }
    finally { rmSync(keyFile, { force: true }); }
  }

  if (error) {
    log(error);
    throw new Error(
      /not found|could not read|denied|authentication/i.test(error)
        ? "Couldn't access the repo. If it's private, add the deploy key to the repo (Settings → Deploy keys) and try again."
        : /branch|remote ref/i.test(error)
          ? `The branch "${row.branch}" doesn't exist in this repo.`
          : "Couldn't download the repo. Check the URL and try again.",
    );
  }
  return dir;
}
