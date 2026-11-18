// Backups aren't built yet. Be honest about it.
import type { Check } from "../types.ts";

export const backups: Check = {
  id: "backups",
  title: "Backups",
  async check() {
    return { status: "info", message: "Automatic backups aren't set up yet.", detail: "If this server is lost, app data is lost too. Backups are coming to Deploy Boat soon." };
  },
};
