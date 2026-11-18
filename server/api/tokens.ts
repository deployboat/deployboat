// Agent tokens: list, create (shown once), revoke. Dashboard only.
import { Hono } from "hono";
import { createToken, listTokens, revokeToken } from "../lib/tokens.ts";

export const tokens = new Hono();

tokens.get("/", (c) => c.json(listTokens()));

tokens.post("/", async (c) => {
  const { name } = await c.req.json().catch(() => ({}));
  const clean = String(name ?? "").trim().slice(0, 60) || "Agent";
  return c.json({ token: createToken(clean), name: clean });
});

tokens.delete("/:id", (c) => {
  revokeToken(Number(c.req.param("id")));
  return c.json({ ok: true });
});
