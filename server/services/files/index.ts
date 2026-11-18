// Files: one shared Garage server (S3-compatible), one bucket + key per app.
// The app gets S3_* (and AWS_*) env vars. Files are public at https://files.<app>.<domain>/
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../lib/config.ts";
import { getEnv, setEnv, deleteEnv } from "../../lib/env.ts";
import * as s3 from "../../lib/s3.ts";
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

// Has this app added file storage?
export const enabled = (app: string) => !!getEnv(app).S3_ACCESS_KEY;

export async function provision(app: string, log: (l: string) => void) {
  await ensureRunning(log);

  // Newer AWS SDKs send checksums Garage doesn't support. Only send them when required.
  setEnv(app, "AWS_REQUEST_CHECKSUM_CALCULATION", "when_required");
  setEnv(app, "AWS_RESPONSE_CHECKSUM_VALIDATION", "when_required");

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

// Size and file count of the app's bucket (for the dashboard).
export async function usage(app: string) {
  const out = await garage("bucket", "info", bucketName(app)).catch(() => "");
  return {
    size: out.match(/Size:\s*([^\n(]+)/)?.[1]?.trim() ?? "0 B",
    objects: Number(out.match(/Objects:\s*(\d+)/)?.[1] ?? 0),
  };
}

// Give the bucket the new name (Garage aliases), then drop the old one.
export async function rename(oldApp: string, newApp: string) {
  if (!getEnv(newApp).S3_BUCKET) return; // nothing created yet
  await garage("bucket", "alias", bucketName(oldApp), bucketName(newApp));
  await garage("bucket", "unalias", bucketName(oldApp)).catch(() => {});
  setEnv(newApp, "S3_BUCKET", bucketName(newApp));
  setEnv(newApp, "S3_PUBLIC_URL", `https://${filesHost(newApp)}`);
}

// An S3 client for the app's own bucket, from this server (the host can reach the container directly).
export async function clientFor(app: string): Promise<s3.S3> {
  const ip = await run("docker", ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", CONTAINER]);
  const env = getEnv(app);
  return { endpoint: `http://${ip}:3900`, region: "garage", bucket: env.S3_BUCKET, accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY };
}

const VARS = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_PUBLIC_URL",
  "AWS_ENDPOINT_URL_S3", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  "AWS_REQUEST_CHECKSUM_CALCULATION", "AWS_RESPONSE_CHECKSUM_VALIDATION"];

// Delete every file, the bucket and its key. The files are gone after this.
export async function destroy(app: string) {
  if (!enabled(app)) return;
  const env = getEnv(app);
  const client = await clientFor(app);
  for (const obj of await s3.list(client)) await s3.remove(client, obj.key);
  await garage("bucket", "delete", "--yes", env.S3_BUCKET).catch(() => {});
  await garage("key", "delete", "--yes", env.S3_ACCESS_KEY).catch(() => {});
  for (const k of VARS) deleteEnv(app, k);
}
