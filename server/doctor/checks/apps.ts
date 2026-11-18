// Apps that crashed or keep restarting. No automatic fix: the logs tell you why.
import type { Check } from "../types.ts";
import { db, isStopped, displayName } from "../../lib/db.ts";
import { run } from "../../lib/shell.ts";
import { containerName } from "../../deploy/run.ts";

export const apps: Check = {
  id: "apps",
  title: "Apps",
  async check() {
    const names = (db.prepare("SELECT name FROM apps").all() as { name: string }[]).map((a) => a.name).filter((n) => !isStopped(n));
    const problems: string[] = [];
    let first = "";
    for (const n of names) {
      const out = await run("docker", ["inspect", "-f", "{{.State.Status}} {{.RestartCount}}", containerName(n)]).catch(() => "missing 0");
      const [state, restarts] = out.split(" ");
      if (state !== "running" || Number(restarts) > 3) {
        problems.push(`${displayName(n)} (${state === "running" ? `restarted ${restarts} times` : state})`);
        first ||= n;
      }
    }
    if (problems.length)
      return { status: "bad", message: `${problems.length} app${problems.length === 1 ? " is" : "s are"} crashing or down.`, detail: problems.join(", "), link: `#/apps/${encodeURIComponent(first)}/logs` };
    return { status: "ok", message: names.length ? `All ${names.length} running apps are healthy.` : "No running apps." };
  },
};
