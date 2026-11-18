// Accounts with an empty password can be logged into with no password at all.
import { readFileSync } from "node:fs";
import type { Check } from "../types.ts";
import { sh } from "../sh.ts";

const empty = () => readFileSync("/etc/shadow", "utf8").split("\n").map((l) => l.split(":")).filter((f) => f.length > 1 && f[1] === "").map((f) => f[0]);

export const emptyPasswords: Check = {
  id: "emptypasswords",
  title: "Empty passwords",
  async check() {
    const users = empty();
    return users.length ? { status: "bad", message: `No password on: ${users.join(", ")}.`, detail: "Anyone could log in as them." }
      : { status: "ok", message: "Every account has a password or is locked." };
  },
  fix: {
    label: "Lock them",
    describe: async () => `Lock these accounts so nobody can log in with a password: ${empty().join(", ")}.\nSSH keys for them keep working.`,
    async run(log) {
      for (const u of empty()) { await sh(`passwd -l ${JSON.stringify(u)}`); log(`Locked ${u}.`); }
    },
  },
};
