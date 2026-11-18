// All settings in one place. Everything has a safe default.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const dataDir = process.env.DEPLOYBOAT_DATA ?? "/var/lib/deployboat";
mkdirSync(dataDir, { recursive: true });

// Secret token for the CLI. Created once, then reused.
const tokenFile = join(dataDir, "token");
if (!existsSync(tokenFile)) {
  writeFileSync(tokenFile, "dbt_" + randomBytes(24).toString("hex"), { mode: 0o600 });
}

const publicIp = process.env.PUBLIC_IP ?? "127.0.0.1";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  token: readFileSync(tokenFile, "utf8").trim(),
  publicIp,
  baseDomain: process.env.BASE_DOMAIN ?? `${publicIp}.nip.io`,
  dashboardHost: `deployboat.${process.env.BASE_DOMAIN ?? `${publicIp}.nip.io`}`,
  dockerNetwork: "deployboat",
};
