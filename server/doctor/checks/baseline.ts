// Shared by checks that warn when something *changes* (new admin, new SSH key).
// The first run saves what's there as normal. "Mark as expected" saves the new state.
import { getSetting, setSetting } from "../../lib/settings.ts";

export const baseline = {
  get: (id: string) => getSetting<{ items: string[] | null }>(`doctor_baseline_${id}`, { items: null }).items,
  set: (id: string, items: string[]) => setSetting(`doctor_baseline_${id}`, { items }),
};

export const diff = (before: string[], now: string[]) => ({
  added: now.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !now.includes(x)),
});
