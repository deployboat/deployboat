// Pull request previews: each open PR gets its own app (<app>-pr-<n>) with its own
// address, and its own EMPTY database/storage if the main app has them, so a preview
// can never touch real data. Closing or merging the PR deletes the preview and its data.
import { db } from "../lib/db.ts";
import { getEnv, setEnv, isBuiltin } from "../lib/env.ts";
import { getGit, queueDeploy } from "./git.ts";
import { enabledServices, addService, removeAllServices } from "../services/index.ts";
import { typeOf } from "../services/database/index.ts";
import { remove } from "./manage.ts";

export const previewName = (app: string, pr: number) => {
  const suffix = `-pr-${pr}`;
  return app.slice(0, 41 - suffix.length).replace(/-+$/, "") + suffix;
};

export async function deployPreview(app: string, pr: number, ref: string, reason: string) {
  const name = previewName(app, pr);
  const main = getGit(app)!;
  const isNew = !db.prepare("SELECT 1 FROM apps WHERE name = ?").get(name);

  if (isNew) {
    db.prepare("INSERT INTO apps (name, display_name, preview_of, pr) VALUES (?, ?, ?, ?)").run(name, `${app} · PR #${pr}`, app, pr);
    // Same repo and deploy key as the main app, but build the PR, and never auto-deploy by itself.
    db.prepare(`INSERT OR REPLACE INTO git (app, repo, branch, private_key, public_key, ref, auto_deploy, previews)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)`).run(name, main.repo, main.branch, main.private_key, main.public_key, ref);
    // The main app's own variables (API keys, settings), but not its database or storage.
    for (const [k, v] of Object.entries(getEnv(app))) if (!isBuiltin(k)) setEnv(name, k, v);
    for (const s of enabledServices(app)) await addService(name, s, () => {}, s === "database" ? typeOf(app) : undefined); // same database type as the app
  }
  return queueDeploy(name, reason);
}

export async function removePreview(app: string, pr: number) {
  const name = previewName(app, pr);
  if (!db.prepare("SELECT 1 FROM apps WHERE name = ? AND preview_of = ?").get(name, app)) return false;
  await removeAllServices(name);
  await remove(name);
  return true;
}

export const previewsOf = (app: string) =>
  db.prepare("SELECT name, pr FROM apps WHERE preview_of = ? ORDER BY pr DESC").all(app) as { name: string; pr: number }[];
