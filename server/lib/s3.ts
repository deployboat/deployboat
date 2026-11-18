// A tiny S3 client: list, download, upload, delete. Works with Garage, AWS,
// Backblaze B2, Cloudflare R2, Wasabi… Requests are signed with AWS Signature V4.
import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type S3 = { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string };

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest();
// S3 wants RFC 3986 encoding (encodeURIComponent leaves !'()* alone).
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encKey = (key: string) => key.split("/").map(enc).join("/");

async function request(s3: S3, method: string, key: string, opts: {
  query?: Record<string, string>; body?: any; length?: number; headers?: Record<string, string>;
} = {}) {
  const base = new URL(s3.endpoint);
  const path = `/${enc(s3.bucket)}${key ? "/" + encKey(key) : ""}`; // path-style: works everywhere
  const query = Object.entries(opts.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");

  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20261118T030000Z
  const day = now.slice(0, 8);
  const payload = "UNSIGNED-PAYLOAD"; // lets us stream big files without hashing them first
  const headers: Record<string, string> = {
    host: base.host,
    "x-amz-date": now,
    "x-amz-content-sha256": payload,
    ...(opts.length !== undefined && { "content-length": String(opts.length) }),
    ...opts.headers,
  };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonical = [method, path, query, names.map((h) => `${h}:${String(headers[h]).trim()}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + s3.secretKey, day), s3.region), "s3"), "aws4_request");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${createHmac("sha256", signingKey).update(toSign).digest("hex")}`;
  delete headers.host;

  const res = await fetch(`${base.origin}${path}${query ? "?" + query : ""}`, {
    method, headers, body: opts.body, ...(opts.body && { duplex: "half" }),
  } as RequestInit);
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Storage said ${res.status}: ${text.match(/<Message>([^<]+)/)?.[1] ?? text.slice(0, 200)}`);
  }
  return res;
}

export async function list(s3: S3, prefix = "") {
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const res = await request(s3, "GET", "", { query: { "list-type": "2", prefix, ...(token && { "continuation-token": token }) } });
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]*)<\/Key>/)?.[1] ?? "";
      out.push({ key: decodeXml(key), size: Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0) });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(xml.match(/<NextContinuationToken>([^<]+)/)?.[1] ?? "") : undefined;
  } while (token);
  return out;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export async function download(s3: S3, key: string, file: string) {
  const res = await request(s3, "GET", key);
  if (res.status === 404 || !res.body) throw new Error(`Not found in storage: ${key}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file));
}

export async function upload(s3: S3, key: string, file: string) {
  await request(s3, "PUT", key, { body: Readable.toWeb(createReadStream(file)), length: statSync(file).size });
}

export async function remove(s3: S3, key: string) {
  await request(s3, "DELETE", key);
}

// Quick check that the settings work: list (at most) one object.
export async function test(s3: S3) {
  await request(s3, "GET", "", { query: { "list-type": "2", "max-keys": "1" } });
}
