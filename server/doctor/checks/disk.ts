// Disk space. Fix: remove old app versions, build cache, old logs and apt cache.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";
import { db } from "../../lib/db.ts";
import { run } from "../../lib/shell.ts";

const KEEP = 5; // versions kept per app (plus whatever is running)

async function usage() {
  const [, total, used] = (await sh("df -kP / | tail -1")).split(/\s+/).map(Number);
  return { total: total * 1024, used: used * 1024, pct: Math.round((used / total) * 100) };
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

// Images of old versions we can delete safely.
async function oldImages() {
  const running = new Set((await run("docker", ["ps", "--format", "{{.Image}}"]).catch(() => "")).split("\n"));
  const apps = db.prepare("SELECT DISTINCT app FROM deploys WHERE image IS NOT NULL").all() as { app: string }[];
  const old: string[] = [];
  for (const { app } of apps) {
    const rows = db.prepare("SELECT image FROM deploys WHERE app = ? AND image IS NOT NULL ORDER BY id DESC").all(app) as { image: string }[];
    rows.slice(KEEP).forEach((r) => { if (!running.has(r.image)) old.push(r.image); });
  }
  const present = await Promise.all(old.map((i) => run("docker", ["image", "inspect", "-f", "{{.Size}}", i]).then(Number, () => 0)));
  return old.map((image, i) => ({ image, size: present[i] })).filter((x) => x.size > 0);
}

export const disk: Check = {
  id: "disk",
  title: "Disk space",
  async check() {
    const u = await usage();
    const msg = `${u.pct}% used (${gb(u.used)} of ${gb(u.total)})`;
    if (u.pct >= 90) return { status: "bad", message: `Disk is almost full: ${msg}.`, detail: "Deploys and databases can fail when the disk is full." };
    if (u.pct >= 80) return { status: "warn", message: `Disk is getting full: ${msg}.` };
    return { status: "ok", message: msg };
  },
  fix: {
    label: "Free up space",
    async describe() {
      const imgs = await oldImages();
      const size = imgs.reduce((n, i) => n + i.size, 0);
      return [
        `Remove ${imgs.length} old app version${imgs.length === 1 ? "" : "s"} (keeps the newest ${KEEP} of each app)${size ? `, up to ${gb(size)}` : ""}.`,
        "Clear the build cache.",
        "Shrink system logs to 200 MB.",
        "Clear the package download cache.",
        "Your apps, databases and files are not touched.",
      ].join("\n");
    },
    async run(log) {
      const before = (await usage()).used;
      for (const { image } of await oldImages()) {
        await run("docker", ["rmi", image]).then(() => log(`Removed ${image}`), () => log(`Skipped ${image} (in use)`));
      }
      log("Clearing build cache…");
      await sh("docker exec buildkit buildctl prune --all").catch(() => log("Build cache: nothing to clear"));
      await sh("docker image prune -f >/dev/null");
      log("Shrinking system logs…");
      await sh("journalctl --vacuum-size=200M >/dev/null 2>&1 || true");
      await sh("apt-get clean");
      const freed = before - (await usage()).used;
      log(`Freed ${gb(Math.max(0, freed))}.`);
    },
  },
};
