// Build cache and unused images pile up with every deploy.
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";
import { run } from "../../lib/shell.ts";

const GB = 1024 ** 3;
const toBytes = (s: string) => {
  const m = s.match(/([\d.]+)\s*([kMGT]?B)/i);
  return m ? Number(m[1]) * ({ B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()] ?? 1) : 0;
};

async function reclaimable() {
  const out = await run("docker", ["system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}"]).catch(() => "");
  let images = 0;
  for (const l of out.split("\n")) if (l.startsWith("Images")) images = toBytes(l.split("\t")[1] ?? "");
  const cache = toBytes(await sh("docker exec buildkit buildctl du 2>/dev/null | tail -1 | awk '{print $2 $3}'").catch(() => ""));
  return { images, cache, total: images + cache };
}

export const dockerSpace: Check = {
  id: "dockerspace",
  title: "Build leftovers",
  async check() {
    const r = await reclaimable();
    const gb = (r.total / GB).toFixed(1);
    if (r.total > 10 * GB) return { status: "warn", message: `${gb} GB of old build cache and unused images.` };
    if (r.total > 3 * GB) return { status: "info", message: `${gb} GB of old build cache and unused images could be freed.` };
    return { status: "ok", message: "Little build leftovers." };
  },
  fix: {
    label: "Clear leftovers",
    describe: async () => `Clear the build cache and images no app or version uses (about ${((await reclaimable()).total / GB).toFixed(1)} GB).\nRunning apps and the newest versions are kept. Next builds may be a bit slower once.`,
    async run(log) {
      await sh("docker exec buildkit buildctl prune --keep-duration 72h || true", log);
      await sh("docker image prune -f", log);
      log("Done.");
    },
  },
};
