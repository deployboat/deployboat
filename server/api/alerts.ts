// Alerts settings: destinations (channels), which events, send a test, find a Telegram chat.
import { Hono } from "hono";
import { getAlerts, saveAlerts, testChannel, newChannelId, EVENTS, type Channel } from "../alerts/index.ts";
import { findTelegramChat } from "../alerts/channels/chat.ts";

export const alerts = new Hono();

// Hide secrets (passwords, tokens, webhook URLs) when sending settings to the browser.
const mask = (ch: Channel) => {
  const label = ch.type === "email" ? ch.to : ch.type === "telegram" ? `chat ${ch.chatId}` : new URL(ch.url).host;
  return { id: ch.id, name: ch.name, type: ch.type, label };
};

alerts.get("/", (c) => {
  const s = getAlerts();
  return c.json({ channels: s.channels.map(mask), events: s.events, eventNames: EVENTS });
});

// Check and clean a new channel. Returns an error message or the channel.
function parse(b: any): string | Channel {
  const name = String(b.name ?? "").trim().slice(0, 40) || b.type;
  const id = newChannelId();
  const httpsUrl = (u: string) => /^https:\/\//.test(u);
  switch (b.type) {
    case "email": {
      const ch = { id, name, type: "email" as const, host: String(b.host ?? "").trim(), port: Number(b.port) || 587,
        user: String(b.user ?? "").trim(), pass: String(b.pass ?? ""), from: String(b.from ?? "").trim(), to: String(b.to ?? "").trim() };
      if (!ch.host || !ch.to) return "Fill in the email server and who to send to.";
      return ch;
    }
    case "discord": case "slack": case "webhook": {
      const url = String(b.url ?? "").trim();
      if (!httpsUrl(url)) return "The webhook URL should start with https://";
      return { id, name, type: b.type, url } as Channel;
    }
    case "telegram": {
      const token = String(b.token ?? "").trim(), chatId = String(b.chatId ?? "").trim();
      if (!/^\d+:[\w-]+$/.test(token)) return "That doesn't look like a bot token (it looks like 123456:ABC…).";
      if (!chatId) return "Find your chat first.";
      return { id, name, type: "telegram", token, chatId };
    }
    default: return "Pick a type.";
  }
}

// Add a channel, but only if a test message gets through.
alerts.post("/channels", async (c) => {
  const ch = parse(await c.req.json().catch(() => ({})));
  if (typeof ch === "string") return c.json({ error: ch }, 400);
  try { await testChannel(ch); }
  catch (e) { return c.json({ error: `The test message didn't get through: ${(e as Error).message}` }, 400); }
  const s = getAlerts();
  saveAlerts({ ...s, channels: [...s.channels, ch] });
  return c.json({ ok: true });
});

alerts.post("/channels/:id/test", async (c) => {
  const ch = getAlerts().channels.find((x) => x.id === c.req.param("id"));
  if (!ch) return c.json({ error: "Not found." }, 404);
  try { await testChannel(ch); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

alerts.delete("/channels/:id", (c) => {
  const s = getAlerts();
  saveAlerts({ ...s, channels: s.channels.filter((x) => x.id !== c.req.param("id")) });
  return c.json({ ok: true });
});

alerts.put("/events", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const s = getAlerts();
  const events = { ...s.events };
  for (const k of Object.keys(EVENTS) as (keyof typeof EVENTS)[]) if (typeof b[k] === "boolean") events[k] = b[k];
  saveAlerts({ ...s, events });
  return c.json({ ok: true, events });
});

alerts.post("/telegram/find-chat", async (c) => {
  const { token } = await c.req.json().catch(() => ({}));
  try { return c.json(await findTelegramChat(String(token ?? "").trim())); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});
