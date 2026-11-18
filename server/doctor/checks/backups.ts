// Are backups on, recent, working, and stored somewhere other than this server?
import type { Check } from "../types.ts";
import { health } from "../../backups/index.ts";

export const backups: Check = {
  id: "backups",
  title: "Backups",
  async check() {
    const h = health();
    if (!h.appsWithData) return { status: "ok", message: "No apps with a database or storage yet. Nothing to back up." };
    if (!h.settings.enabled) return { status: "warn", message: "Automatic backups are turned off.", link: "#/backups" };
    if (h.failed) return { status: "bad", message: `${h.failed} backup${h.failed === 1 ? "" : "s"} failed in the last day.`, link: "#/backups" };
    const age = h.lastAt ? (Date.now() - Date.parse(h.lastAt.replace(" ", "T") + "Z")) / 3600000 : Infinity;
    if (age > 26) return { status: "warn", message: h.lastAt ? "The last backup is more than a day old." : "No backups yet.", detail: `The next one runs at ${h.settings.time}. You can also run one now.`, link: "#/backups" };
    if (h.remoteFailed) return { status: "warn", message: "Backups worked, but the off-server copy failed.", link: "#/backups" };
    if (!h.settings.remote) return { status: "info", message: "Backups only live on this server.", detail: "If the server is lost, so are they. Add Google Drive or S3 storage on the Backups page.", link: "#/backups" };
    return { status: "ok", message: "Backed up in the last day, with an off-server copy." };
  },
};
