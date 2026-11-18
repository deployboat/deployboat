// Share page: public or password protected, plus a private link.
import { Hono } from "hono";
import { getShare, setShare, resetToken } from "../lib/share.ts";
import { syncRoutes } from "../deploy/route.ts";
import { appUrl } from "../deploy/index.ts";

export const share = new Hono();

const view = (app: string) => {
  const s = getShare(app);
  return {
    url: appUrl(app),
    mode: s.mode,
    username: s.username,
    password: s.password,
    privateLink: s.mode === "password" && s.token ? `${appUrl(app)}/?share=${s.token}` : null,
  };
};

share.get("/:name/share", (c) => c.json(view(c.req.param("name"))));

share.put("/:name/share", async (c) => {
  const name = c.req.param("name");
  const { mode, username, password } = await c.req.json().catch(() => ({}));
  if (mode !== "public" && mode !== "password") return c.json({ error: "Choose public or password protected." }, 400);
  if (mode === "password") {
    const cur = getShare(name);
    if (!password && !cur.password) return c.json({ error: "Choose a password." }, 400);
    if (password && String(password).length < 4) return c.json({ error: "Use at least 4 characters for the password." }, 400);
    if (username && !/^[\w.@-]{1,40}$/.test(username)) return c.json({ error: "Username: letters, numbers, . _ @ - only." }, 400);
  }
  try { await setShare(name, mode, username, password ? String(password) : undefined); }
  catch { return c.json({ error: "Couldn't save the password. Try again." }, 500); }
  await syncRoutes();
  return c.json(view(name));
});

// Old private links stop working.
share.post("/:name/share/reset-link", async (c) => {
  const name = c.req.param("name");
  resetToken(name);
  await syncRoutes();
  return c.json(view(name));
});
