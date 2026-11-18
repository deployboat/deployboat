// Files: one shared Garage server (S3-compatible), one bucket + key per app.
// The app gets S3_* (and AWS_*) env vars. Files are public at https://files.<app>.<domain>/
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../lib/config.ts";
import { getEnv, setEnv } from "../../lib/env.ts";
import { run } from "../../lib/shell.ts";

const CONTAINER = "garage";
const IMAGE = "dxflrs/garage:v1.1.0";
const dir = join(config.dataDir, "garage");

export const bucketName = (app: string) => `app-${app}`;
export const filesHost = (app: string) => `files.${app}.${config.baseDomain}`;
// Caddy sends public file requests here, with this Host header.
export const webUpstream = { dial: `${CONTAINER}:3902`, host: (app: string) => `${bucketName(app)}.web.garage` };

const garage = (...args: string[]) => run("docker", ["exec", CONTAINER, "/garage", ...args]);

function writeConfigOnce() {
  const file = join(dir, "garage.toml");
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${randomBytes(32).toString("hex")}"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage"

[s3_web]
bind_addr = "[::]:3902"
root_domain = ".web.garage"
index = "index.html"
`, { mode: 0o600 });
}

async function waitUntilReady() {
  for (let i = 0; i < 60; i++) {
    if (await garage("status").then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The file storage server didn't start. Try deploying again.");
}

async function ensureRunning(log: (l: string) => void) {
  const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER]).catch(() => "missing");
  if (state === "true") return;
  if (state !== "missing") { await run("docker", ["start", CONTAINER]); return waitUntilReady(); }

  log("→ Setting up file storage (first time only)…");
  writeConfigOnce();
  await run("docker", [
    "run", "-d",
    "--name", CONTAINER,
    "--network", config.dockerNetwork,
    "--restart", "unless-stopped",
    "-v", `${join(dir, "garage.toml")}:/etc/garage.toml`,
    "-v", `${join(dir, "meta")}:/var/lib/garage/meta`,
    "-v", `${join(dir, "data")}:/var/lib/garage/data`,
    IMAGE,
  ]);
  await waitUntilReady();

  // A single-server Garage needs a "layout" once: this node stores everything.
  const nodeId = (await garage("node", "id", "-q")).split("@")[0];
  await garage("layout", "assign", "-z", "dc1", "-c", "100G", nodeId);
  await garage("layout", "apply", "--version", "1");
}

export async function provision(app: string, log: (l: string) => void) {
  await ensureRunning(log);

  const bucket = bucketName(app);
  const bucketExists = await garage("bucket", "info", bucket).then(() => true, () => false);
  if (getEnv(app).S3_ACCESS_KEY && bucketExists) return;

  log("→ Creating your file storage…");
  if (!bucketExists) await garage("bucket", "create", bucket);
  await garage("bucket", "website", "--allow", bucket);

  const out = await garage("key", "create", bucket);
  const keyId = out.match(/Key ID:\s*(\S+)/)?.[1];
  const secret = out.match(/Secret key:\s*(\S+)/)?.[1];
  if (!keyId || !secret) throw new Error("Couldn't create file storage keys. Try deploying again.");
  await garage("bucket", "allow", "--read", "--write", "--owner", bucket, "--key", keyId);

  const vars = {
    S3_ENDPOINT: `http://${CONTAINER}:3900`,
    S3_REGION: "garage",
    S3_BUCKET: bucket,
    S3_ACCESS_KEY: keyId,
    S3_SECRET_KEY: secret,
    S3_PUBLIC_URL: `https://${filesHost(app)}`,
    // Same values under the names AWS SDKs read automatically.
    AWS_ENDPOINT_URL_S3: `http://${CONTAINER}:3900`,
    AWS_REGION: "garage",
    AWS_ACCESS_KEY_ID: keyId,
    AWS_SECRET_ACCESS_KEY: secret,
  };
  for (const [k, v] of Object.entries(vars)) setEnv(app, k, v);
}
