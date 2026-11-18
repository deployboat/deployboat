// Off-server copies in any S3-compatible storage (Backblaze B2, Cloudflare R2, Wasabi, AWS…).
import * as s3 from "../../lib/s3.ts";

export type S3Remote = { type: "s3"; endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string; prefix: string };

const key = (r: S3Remote, name: string) => `${r.prefix.replace(/\/+$/, "")}/${name}`.replace(/^\//, "");

export const s3Remote = {
  test: (r: S3Remote) => s3.test(r),
  // Returns the id we need later to download or delete it (here: the object key).
  upload: async (r: S3Remote, file: string, name: string) => { await s3.upload(r, key(r, name), file); return key(r, name); },
  download: (r: S3Remote, id: string, file: string) => s3.download(r, id, file),
  remove: (r: S3Remote, id: string) => s3.remove(r, id),
};
