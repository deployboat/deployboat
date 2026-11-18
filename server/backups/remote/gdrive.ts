// Off-server copies in Google Drive, with the user's own Google credentials.
//
// Connecting uses Google's "device" sign-in: we show a short code, the user enters it
// at google.com/device. We only ask for drive.file: Deploy Boat can see the files it
// created, nothing else in the user's Drive.
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DriveRemote = { type: "gdrive"; clientId: string; clientSecret: string; refreshToken: string; folderId: string; email?: string };

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER = "Deploy Boat Backups";

async function post(url: string, form: Record<string, string>) {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(form) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) as any };
}

// --- connecting ---------------------------------------------------------------

export async function startDeviceLogin(clientId: string) {
  const { ok, data } = await post("https://oauth2.googleapis.com/device/code", { client_id: clientId, scope: SCOPE });
  if (!ok) throw new Error(data.error === "invalid_client"
    ? "Google doesn't know this client ID. Check it, and make sure its type is \"TVs and Limited Input devices\"."
    : `Google said: ${data.error_description ?? data.error ?? "unknown error"}`);
  return { deviceCode: data.device_code as string, userCode: data.user_code as string, url: data.verification_url as string, interval: Number(data.interval) || 5 };
}

// "pending" until the user enters the code, then the refresh token.
export async function pollDeviceLogin(clientId: string, clientSecret: string, deviceCode: string) {
  const { data } = await post("https://oauth2.googleapis.com/token", {
    client_id: clientId, client_secret: clientSecret, device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (data.refresh_token) return { refreshToken: data.refresh_token as string, accessToken: data.access_token as string };
  if (data.error === "authorization_pending" || data.error === "slow_down") return "pending" as const;
  if (data.error === "access_denied") throw new Error("Access was denied in Google.");
  if (data.error === "expired_token") throw new Error("The code expired. Start again.");
  throw new Error(`Google said: ${data.error_description ?? data.error}`);
}

// --- using it -----------------------------------------------------------------

let cached: { token: string; until: number; for: string } | null = null;

async function accessToken(r: Pick<DriveRemote, "clientId" | "clientSecret" | "refreshToken">) {
  if (cached && cached.for === r.refreshToken && cached.until > Date.now()) return cached.token;
  const { ok, data } = await post("https://oauth2.googleapis.com/token", {
    client_id: r.clientId, client_secret: r.clientSecret, refresh_token: r.refreshToken, grant_type: "refresh_token",
  });
  if (!ok) throw new Error(data.error === "invalid_grant"
    ? "Google Drive access expired or was removed. Connect Google Drive again (Backups page)."
    : `Google said: ${data.error_description ?? data.error}`);
  cached = { token: data.access_token, until: Date.now() + (Number(data.expires_in) - 60) * 1000, for: r.refreshToken };
  return cached.token;
}

async function drive(r: Parameters<typeof accessToken>[0], url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${await accessToken(r)}`, ...init.headers } });
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`Google Drive said ${res.status}: ${err.error?.message ?? "unknown error"}`);
  }
  return res;
}

// Make the "Deploy Boat Backups" folder (once) and find out whose Drive it is.
export async function setupFolder(r: Pick<DriveRemote, "clientId" | "clientSecret" | "refreshToken">) {
  const about = await (await drive(r, "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")).json() as any;
  const res = await drive(r, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = await res.json() as any;
  return { folderId: folder.id as string, email: about.user?.emailAddress as string | undefined };
}

export const driveRemote = {
  test: async (r: DriveRemote) => { await drive(r, `https://www.googleapis.com/drive/v3/files/${r.folderId}?fields=id`); },

  // Resumable upload: first ask for an upload URL, then send the file to it.
  async upload(r: DriveRemote, file: string, name: string) {
    const start = await drive(r, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: { "content-type": "application/json", "x-upload-content-type": "application/gzip" },
      body: JSON.stringify({ name, parents: [r.folderId] }),
    });
    const location = start.headers.get("location");
    if (!location) throw new Error("Google Drive didn't accept the upload.");
    const res = await fetch(location, {
      method: "PUT",
      headers: { "content-length": String(statSync(file).size), "content-type": "application/gzip" },
      body: Readable.toWeb(createReadStream(file)) as any,
      duplex: "half",
    } as RequestInit);
    if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}).`);
    return ((await res.json()) as any).id as string;
  },

  async download(r: DriveRemote, id: string, file: string) {
    const res = await drive(r, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    if (res.status === 404 || !res.body) throw new Error("This backup isn't in Google Drive anymore.");
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file));
  },

  remove: async (r: DriveRemote, id: string) => { await drive(r, `https://www.googleapis.com/drive/v3/files/${id}`, { method: "DELETE" }); },
};
