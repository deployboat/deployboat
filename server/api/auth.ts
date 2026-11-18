// Login for the dashboard (cookie) and the CLI (Bearer token). Same token for both.
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { timingSafeEqual } from "node:crypto";
import { config } from "../lib/config.ts";

const COOKIE = "deployboat";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function requireLogin(c: Context, next: Next) {
  const bearer = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  const cookie = getCookie(c, COOKIE) ?? "";
  if (!same(bearer, config.token) && !same(cookie, config.token)) {
    return c.json({ error: "Please log in. Your token is on the server: sudo cat /var/lib/deployboat/token" }, 401);
  }
  await next();
}

export async function login(c: Context) {
  const { token } = await c.req.json().catch(() => ({ token: "" }));
  if (!same(String(token ?? "").trim(), config.token)) return c.json({ error: "That token is not correct." }, 401);
  setCookie(c, COOKIE, config.token, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return c.json({ ok: true });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}
