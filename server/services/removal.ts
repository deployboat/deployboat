// Deleting an app's database or storage, as a background job.
//
// It can take a while (a last backup first), so the dashboard doesn't wait on one long
// request: it starts the job, then asks how it's going (removalStatus) every second or two.
//
//   1. back up only the part being deleted (database or storage), at low priority
//   2. stop the app, so it isn't failing against a database that's going away
//   3. delete it
//   4. start the app again, without the variables
import { db } from "../lib/db.ts";
import { isBusy, lock, unlock } from "../lib/lock.ts";
import { backupNow, isRunning as backupRunning } from "../backups/index.ts";
import type { Part } from "../backups/archive.ts";
import { syncRoutes } from "../deploy/route.ts";
import { restart } from "../deploy/manage.ts";
import { containerName } from "../deploy/network.ts";
import { run } from "../lib/shell.ts";
import { isStopped } from "../lib/db.ts";
import { removeService, type ServiceName } from "./index.ts";
import { typeOf } from "./database/index.ts";

export type Removal = { service: ServiceName; step: string; done: boolean; error: string | null };

// One job per app at a time. Kept in memory: a restart of Deploy Boat forgets it (the
// app's lock goes too), which is fine because the steps can simply be run again.
const jobs = new Map<string, Removal>();
export const removalStatus = (app: string) => jobs.get(app) ?? null;

export function startRemoval(app: string, service: ServiceName, { backup }: { backup: boolean }) {
  if (isBusy(app)) throw new Error("Wait until the current deploy (or removal) finishes.");
  if (backup && backupRunning()) throw new Error("A backup is running right now. Try again in a minute.");

  const job: Removal = { service, step: "Starting…", done: false, error: null };
  jobs.set(app, job);
  lock(app);

  (async () => {
    const wasStopped = isStopped(app);
    try {
      if (backup) {
        // SQLite is a file in /data, so its backup is the data folder.
        const parts: Part[] = service === "storage" ? ["storage"] : typeOf(app) === "sqlite" ? ["data"] : ["database"];
        job.step = `Backing up the ${service === "storage" ? "stored files" : "database"}…`;
        await backupNow(app, parts, ` · before deleting the ${service}`);
        const last = db.prepare("SELECT status, note FROM backups WHERE app = ? ORDER BY id DESC LIMIT 1").get(app) as { status: string; note: string } | undefined;
        if (last?.status !== "done") throw new Error(`The backup failed, so nothing was deleted. ${last?.note ?? ""}`);
      }
      job.step = "Stopping the app…";
      // Just the container. Not stop() from manage.ts: that marks the app as stopped by you.
      await run("docker", ["stop", containerName(app)]).catch(() => {});
      job.step = `Deleting the ${service}…`;
      await removeService(app, service);
      await syncRoutes().catch(() => {}); // only storage changes routes; a hiccup here mustn't look like a failed delete
      if (!wasStopped) {
        job.step = "Starting the app again…";
        await restart(app).catch(() => {}); // fine if it was never deployed
      }
      job.step = "Done.";
      job.done = true;
    } catch (e) {
      job.error = (e as Error).message;
      job.done = true;
      // If we stopped it, don't leave it down.
      if (!wasStopped) await restart(app).catch(() => {});
    } finally {
      unlock(app);
    }
  })();
}
