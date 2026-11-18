// A deploy is 3 steps: build → start → route. Read the files in that order.
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { build } from "./build.ts";
import { start } from "./run.ts";
import { syncRoutes } from "./route.ts";

export const appUrl = (name: string) => `https://${name}.${config.baseDomain}`;

export async function deploy(name: string, srcDir: string, log: (l: string) => void): Promise<string> {
  db.prepare("INSERT OR IGNORE INTO apps (name) VALUES (?)").run(name);
  const { lastInsertRowid: id } = db.prepare("INSERT INTO deploys (app, status) VALUES (?, 'building')").run(name);

  const lines: string[] = [];
  const logAndSave = (l: string) => { lines.push(l); log(l); };
  const finish = (status: string) =>
    db.prepare("UPDATE deploys SET status = ?, log = ? WHERE id = ?").run(status, lines.join("\n"), id);

  try {
    const image = await build(name, srcDir, logAndSave);
    await start(name, image, logAndSave);
    await syncRoutes();
    finish("live");
    return appUrl(name);
  } catch (e) {
    finish("failed");
    throw e;
  }
}
