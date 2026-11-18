// One place to talk to whichever off-server destination is set up.
import { s3Remote, type S3Remote } from "./s3.ts";
import { driveRemote, type DriveRemote } from "./gdrive.ts";

export type Remote = S3Remote | DriveRemote;

const impl = (r: Remote): typeof s3Remote => (r.type === "s3" ? s3Remote : driveRemote) as any;

export const remote = {
  test: (r: Remote) => impl(r).test(r as any),
  upload: (r: Remote, file: string, name: string) => impl(r).upload(r as any, file, name),
  download: (r: Remote, id: string, file: string) => impl(r).download(r as any, id, file),
  remove: (r: Remote, id: string) => impl(r).remove(r as any, id),
};

export const describe = (r: Remote | null) =>
  !r ? null : r.type === "s3" ? `S3: ${r.bucket} (${new URL(r.endpoint).host})` : `Google Drive${r.email ? `: ${r.email}` : ""}`;
