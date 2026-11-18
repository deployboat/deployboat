// Members of the "docker" group can control Docker, which is the same as being root.
import { readFileSync } from "node:fs";
import type { Check } from "../types.ts";

export const dockerGroup: Check = {
  id: "dockergroup",
  title: "Docker access",
  async check() {
    const line = readFileSync("/etc/group", "utf8").split("\n").find((l) => l.startsWith("docker:"));
    const users = (line?.split(":")[3] ?? "").split(",").filter(Boolean);
    if (!users.length) return { status: "ok", message: "Only root can use Docker." };
    return { status: "info", message: `Can use Docker (same as root): ${users.join(", ")}.`,
      detail: "Fine if that's you. To remove someone: sudo gpasswd -d <user> docker" };
  },
};
