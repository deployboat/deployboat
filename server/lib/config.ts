// All settings in one place. Everything has a safe default.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const dataDir = process.env.DEPLOYBOAT_DATA ?? "/var/lib/deployboat";
mkdirSync(dataDir, { recursive: true });
// Only root may look inside: it holds app secrets, deploy keys and passwords.
try { chmodSync(dataDir, 0o700); } catch { /* not root, e.g. local dev */ }

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
  // The free addresses: always work, even without a domain of your own.
  nipDomain: `${publicIp}.nip.io`,
  nipDashboard: `deployboat.${publicIp}.nip.io`,
  // Where apps and the dashboard live. Your own domain if you set one (installer or Settings),
  // otherwise the free nip.io ones. lib/domains.ts loads the saved choice at startup.
  baseDomain: process.env.BASE_DOMAIN || `${publicIp}.nip.io`,
  dashboardHost: `deployboat.${process.env.BASE_DOMAIN || `${publicIp}.nip.io`}`,
  dockerNetwork: "deployboat",
};

// Make a new main token. The old one stops working right away.
export function resetMainToken() {
  const token = "dbt_" + randomBytes(24).toString("hex");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  config.token = token;
  return token;
}
