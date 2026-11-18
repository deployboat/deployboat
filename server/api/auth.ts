// Who's calling, and what they may do.
//
//  - admin: the main token (dashboard cookie, or Bearer). Can do everything.
//  - agent: an agent token (Bearer dba_…). Can deploy and manage what an app needs,
//           but can't delete, change the server, or see secrets. See AGENT_CAN below.
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { timingSafeEqual } from "node:crypto";
import { config } from "../lib/config.ts";
import { checkToken } from "../lib/tokens.ts";
import { waitSeconds, failed, succeeded } from "../lib/ratelimit.ts";

const COOKIE = "deployboat";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Everything an agent token may call. Anything else is refused.
const APP = "/api/apps/[^/]+";
const AGENT_CAN: [string, RegExp][] = [
  ["POST", /^\/api\/deploy\/[^/]+$/],
  ["GET", /^\/api\/apps$/],
  ["GET", new RegExp(`^${APP}$`)],
  ["GET", new RegExp(`^${APP}/logs$`)],
  ["GET", new RegExp(`^${APP}/deploys/\\d+$`)],
  ["GET", new RegExp(`^${APP}/env$`)],          // names only, see api/apps.ts
  ["PUT", new RegExp(`^${APP}/env$`)],
  ["DELETE", new RegExp(`^${APP}/env/[^/]+$`)],
  ["GET", /^\/api\/resolve\/[^/]+$/],
  ["GET", /^\/api\/agent-guide$/],
];

// The visitor's address. Caddy (the only way in) puts it in X-Forwarded-For.
const ipOf = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";

const slowDown = (c: Context, s: number) =>
  c.json({ error: `Too many wrong tries. Wait ${s > 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`} and try again.` }, 429);

export async function requireLogin(c: Context, next: Next) {
  const ip = ipOf(c);
  const wait = waitSeconds(ip);
  if (wait) return slowDown(c, wait);

  const bearer = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  const cookie = getCookie(c, COOKIE) ?? "";

  if (same(bearer, config.token) || same(cookie, config.token)) {
    c.set("role", "admin");
    return next();
  }
  if (checkToken(bearer) !== null) {
    const path = c.req.path.replace(/\/$/, "");
    if (!AGENT_CAN.some(([m, re]) => m === c.req.method && re.test(path))) {
      return c.json({ error: "This token can't do that. Use the Deploy Boat dashboard." }, 403);
    }
    c.set("role", "agent");
    return next();
  }
  // Only count actual wrong tokens, not "not logged in yet" (no token at all).
  if (bearer || cookie) failed(ip);
  // An old cookie (e.g. after a token reset): drop it, so open tabs don't keep counting as wrong tries.
  if (cookie) deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ error: "Please log in. Your token is wrong, or it was revoked." }, 401);
}

export const isAdmin = (c: Context) => c.get("role") === "admin";

// Keep this browser logged in with the (new) main token.
export const setLoginCookie = (c: Context) =>
  setCookie(c, COOKIE, config.token, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 30 });

export async function login(c: Context) {
  const ip = ipOf(c);
  const wait = waitSeconds(ip);
  if (wait) return slowDown(c, wait);
  const { token } = await c.req.json().catch(() => ({ token: "" }));
  if (!same(String(token ?? "").trim(), config.token)) { failed(ip); return c.json({ error: "That token is not correct." }, 401); }
  succeeded(ip);
  setLoginCookie(c);
  return c.json({ ok: true });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}
