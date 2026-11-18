// The shared file storage (Garage).
import type { Check } from "../types.ts";
import { run } from "../../lib/shell.ts";

export const storage: Check = {
  id: "storage",
  title: "File storage server",
  async check() {
    const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", "garage"]).catch(() => "");
    if (!state) return { status: "ok", message: "No app uses file storage yet." };
    if (state !== "true") return { status: "info", message: "File storage isn't running (see Built-in services)." };
    const ok = await run("docker", ["exec", "garage", "/garage", "status"]).then(() => true, () => false);
    return ok ? { status: "ok", message: "File storage is healthy." }
      : { status: "bad", message: "File storage is running but unhealthy.", detail: "Uploads and downloads in apps may fail. Restart it on the System page." };
  },
};
