// Which Deploy Boat version this server runs, and whether a newer one is out.
//
// Most servers run a release (a git tag like v0.5.0) and compare with the newest release.
// Servers installed with --edge follow main: they count the new commits on main.
// Used by the dashboard (sidebar, System page) and by Server Doctor's version check.
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { run } from "./shell.ts";
import { config } from "./config.ts";

export const REPO = resolve(process.cwd(), ".."); // server/ runs from inside the repo

const git = (...args: string[]) => {
  try { return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
};

export const isEdge = () => {
  const file = `${config.dataDir}/channel`;
  return existsSync(file) && readFileSync(file, "utf8").trim() === "edge";
};

// Worked out once at start: the version only changes when Deploy Boat restarts after an update.
// "v0.5.0" on a release. Otherwise (edge, or an older install that followed main) the VERSION
// file plus the commit, like "0.5.0 · main (1a2b3c4)".
const fileVersion = (() => { try { return readFileSync(`${REPO}/VERSION`, "utf8").trim(); } catch { return ""; } })();
export const CURRENT = git("describe", "--tags", "--exact-match")
  || (git("log", "-1", "--format=%h") ? `${fileVersion || "dev"} · main (${git("log", "-1", "--format=%h")})` : fileVersion ? `v${fileVersion}` : "unknown");

// "v0.10.0" is newer than "v0.9.2": compare the numbers one by one.
export function newerThan(a: string, b: string) {
  const pa = a.replace(/^v/, "").split(".").map(Number), pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

export type VersionInfo = {
  current: string;        // what runs now
  edge: boolean;          // follows main instead of releases
  update: string | null;  // "v0.6.0", or "3 new changes on main", or null if up to date
  notes: string | null;   // link to the new release's notes
};

// Asks GitHub at most once an hour.
let cache: { at: number; info: VersionInfo } | null = null;

export async function versionInfo(fresh = false): Promise<VersionInfo> {
  if (!fresh && cache && Date.now() - cache.at < 3600_000) return cache.info;
  let info: VersionInfo;
  if (isEdge()) {
    await run("git", ["-C", REPO, "fetch", "-q", "origin", "main"]).catch(() => {});
    const n = Number(git("rev-list", "--count", "HEAD..origin/main")) || 0;
    info = { current: CURRENT, edge: true, update: n ? `${n} new change${n === 1 ? "" : "s"} on main` : null, notes: null };
  } else {
    const out = await run("git", ["-C", REPO, "ls-remote", "--tags", "--refs", "--sort=-v:refname", "origin", "v*"]).catch(() => "");
    const latest = out.split("\n")[0]?.split("refs/tags/")[1]?.trim() ?? "";
    const mine = git("describe", "--tags", "--abbrev=0");
    const update = latest && (!mine || newerThan(latest, mine)) ? latest : null;
    info = { current: CURRENT, edge: false, update,
      notes: update ? `https://github.com/deployboat/deployboat/releases/tag/${update}` : null };
  }
  cache = { at: Date.now(), info };
  return info;
}
