// Agent tokens nobody uses anymore are just a risk if they leak.
import type { Check } from "../types.ts";
import { db } from "../../lib/db.ts";
import { revokeToken } from "../../lib/tokens.ts";

const stale = () => db.prepare(`SELECT id, name FROM tokens WHERE
  (last_used_at IS NULL AND created_at < datetime('now', '-30 days')) OR last_used_at < datetime('now', '-90 days')`).all() as { id: number; name: string }[];

export const oldTokens: Check = {
  id: "oldtokens",
  title: "Unused agent tokens",
  async check() {
    const t = stale();
    if (!t.length) return { status: "ok", message: "No unused agent tokens." };
    return { status: "info", message: `${t.length} agent token${t.length === 1 ? " hasn't" : "s haven't"} been used in a long time: ${t.map((x) => x.name).join(", ")}.`, link: "#/settings" };
  },
  fix: {
    label: "Revoke them",
    describe: async () => `Revoke: ${stale().map((x) => x.name).join(", ")}.\nAnything still using them stops working.`,
    async run(log) { for (const t of stale()) { revokeToken(t.id); log(`Revoked ${t.name}.`); } },
  },
};
