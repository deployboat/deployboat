// Things you do to an app after it's deployed: status, logs, restart, delete.
import { db } from "../lib/db.ts";
import { run } from "../lib/shell.ts";
import { containerName, start } from "./run.ts";
import { syncRoutes } from "./route.ts";
import { renameServices } from "../services/index.ts";

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
  await run("docker", ["rm", "-f", containerName(app)]).catch(() => {});
  db.prepare("DELETE FROM apps WHERE name = ?").run(app);
  db.prepare("DELETE FROM deploys WHERE app = ?").run(app);
  db.prepare("DELETE FROM env WHERE app = ?").run(app);
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
  db.prepare("UPDATE aliases SET name = ? WHERE name = ?").run(newName, oldName);
  db.prepare("DELETE FROM aliases WHERE old = ?").run(newName);
  db.prepare("INSERT OR REPLACE INTO aliases (old, name) VALUES (?, ?)").run(oldName, newName);

  await renameServices(oldName, newName);
  if (image) await start(newName, image, () => {});
  await syncRoutes();
}
