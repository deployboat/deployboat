// A deploy is: get source → build → services → start → route. Read the files in that order.
import { config } from "../lib/config.ts";
import { db } from "../lib/db.ts";
import { build } from "./build.ts";
import { provisionServices, addService, parseService } from "../services/index.ts";
import { start } from "./run.ts";
import { syncRoutes } from "./route.ts";
import { notify } from "../alerts/index.ts";
import { mainHost } from "../lib/domains.ts";

// The app's main address (its own domain if the free address is turned off, see lib/domains.ts).
export const appUrl = (name: string) => `https://${mainHost(name)}`;

// `source` is a folder that's already there (CLI upload), or a function that
// fetches the code first (Git). Either way, the log is saved as it happens.
export async function deploy(
  name: string,
  source: string | ((log: (l: string) => void) => Promise<string>),
  log: (l: string) => void = () => {},
  add: string[] = [],   // services to add on this deploy, e.g. ["database"], ["mysql", "storage"]
): Promise<string> {
  db.prepare("INSERT OR IGNORE INTO apps (name) VALUES (?)").run(name);
  const { lastInsertRowid: id } = db.prepare("INSERT INTO deploys (app, status) VALUES (?, 'building')").run(name);

  const lines: string[] = [];
  const saveLog = db.prepare("UPDATE deploys SET log = ? WHERE id = ?");
  const save = (l: string) => { lines.push(l); saveLog.run(lines.join("\n"), id); };
  const logAndSave = (l: string) => { save(l); log(l); };
  const finish = (status: string) =>
    db.prepare("UPDATE deploys SET status = ?, log = ? WHERE id = ?").run(status, lines.join("\n"), id);

  try {
    const srcDir = typeof source === "string" ? source : await source(logAndSave);
    const image = await build(name, srcDir, logAndSave);
    db.prepare("UPDATE deploys SET image = ? WHERE id = ?").run(image, id);
    for (const s of add) {
      const p = parseService(s);
      if (p) await addService(name, p.service, logAndSave, p.type);
    }
    await provisionServices(name, logAndSave);
    await start(name, image, logAndSave);
    await syncRoutes().catch(() => {
      throw new Error("Your app is running but we couldn't publish its address. Try deploying again.");
    });
    save(`✓ Live: ${appUrl(name)}`); // the CLI prints its own final line
    finish("live");
    return appUrl(name);
  } catch (e) {
    save(`✗ ${(e as Error).message}`);
    finish("failed");
    notify("deployFailed", `Deploy failed: ${name}`, (e as Error).message, `#/apps/${name}/versions`);
    throw e;
  }
}
