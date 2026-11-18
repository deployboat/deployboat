// Things you do to an app after it's deployed: status, logs, restart, delete.
import { db, setStopped } from "../lib/db.ts";
import { run } from "../lib/shell.ts";
import { containerName, start } from "./run.ts";
import { removeNetwork } from "./network.ts";
import { syncRoutes } from "./route.ts";
import { renameServices, removeAllServices } from "../services/index.ts";
import "./git.ts"; // makes sure the git table exists
import "../lib/domains.ts"; // and the domains table
import "../lib/share.ts"; // and the share table
import { removeCrons } from "../crons/index.ts";
import "../backups/index.ts"; // makes sure the backups table exists
import "../monitor/index.ts"; // and the metrics tables

// "running", "exited", "restarting"… or "missing" if there's no container.
export const containerState = (app: string) =>
  run("docker", ["inspect", "-f", "{{.State.Status}}", containerName(app)]).catch(() => "missing");

export const appLogs = (app: string, lines = 200) =>
  run("docker", ["logs", "--tail", String(lines), "--timestamps", containerName(app)]).catch(() => "");

// The Docker image the app is running right now ("" if none).
export const currentImage = (app: string) =>
  run("docker", ["inspect", "-f", "{{.Config.Image}}", containerName(app)]).catch(() => "");

// Recreate the container from the same image. Picks up new env vars.
export async function restart(app: string) {
  const image = await currentImage(app);
  if (!image) throw new Error("This app has no running version. Deploy it first.");
  await start(app, image, () => {});
}

// Switch the app to an older (or newer) version.
export async function activate(app: string, image: string) {
  const exists = await run("docker", ["image", "inspect", image]).then(() => true, () => false);
  if (!exists) throw new Error("This version was cleaned up and can't be restored.");
  await start(app, image, () => {});
}

// Remove the app and its address. Its database and files are kept on purpose.
export async function remove(app: string) {
  // Previews of this app go too, with their (throwaway) data.
  for (const { name } of db.prepare("SELECT name FROM apps WHERE preview_of = ?").all(app) as { name: string }[]) {
    await removeAllServices(name).catch(() => {});
    await remove(name);
  }
  await run("docker", ["rm", "-f", containerName(app)]).catch(() => {});
  await removeNetwork(app);
  for (const t of ["metrics", "metrics_hour"]) db.prepare(`DELETE FROM ${t} WHERE key LIKE ?`).run(`app:${app}:%`);
  db.prepare("DELETE FROM apps WHERE name = ?").run(app);
  db.prepare("DELETE FROM deploys WHERE app = ?").run(app);
  db.prepare("DELETE FROM env WHERE app = ?").run(app);
  db.prepare("DELETE FROM git WHERE app = ?").run(app);
  db.prepare("DELETE FROM domains WHERE app = ?").run(app);
  db.prepare("DELETE FROM share WHERE app = ?").run(app);
  removeCrons(app);
  await syncRoutes();
}

// Rename an app: container, address, database, storage. The old name keeps
// working for CLI deploys (see aliases in lib/db.ts).
export async function rename(oldName: string, newName: string) {
  const image = await currentImage(oldName);
  await run("docker", ["rm", "-f", containerName(oldName)]).catch(() => {});

  db.prepare("UPDATE apps SET name = ? WHERE name = ?").run(newName, oldName);
  db.prepare("UPDATE deploys SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE env SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE git SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE domains SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE share SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE crons SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE backups SET app = ? WHERE app = ?").run(newName, oldName);
  db.prepare("UPDATE apps SET preview_of = ? WHERE preview_of = ?").run(newName, oldName);
  // Keep the app's history under its new name.
  for (const t of ["metrics", "metrics_hour"]) db.prepare(`UPDATE ${t} SET key = 'app:' || ? || substr(key, length('app:' || ?) + 1) WHERE key LIKE ?`).run(newName, oldName, `app:${oldName}:%`);
  db.prepare("UPDATE aliases SET name = ? WHERE name = ?").run(newName, oldName);
  db.prepare("DELETE FROM aliases WHERE old = ?").run(newName);
  db.prepare("INSERT OR REPLACE INTO aliases (old, name) VALUES (?, ?)").run(oldName, newName);

  await renameServices(oldName, newName);
  await removeNetwork(oldName);
  if (image) await start(newName, image, () => {});
  await syncRoutes();
}

// Stop the app. It stays stopped (even after a server reboot) until you start it.
export async function stop(app: string) {
  await run("docker", ["stop", containerName(app)]);
  setStopped(app, true);
}

export async function resume(app: string) {
  await run("docker", ["start", containerName(app)]).catch(() => restart(app));
  setStopped(app, false);
}
