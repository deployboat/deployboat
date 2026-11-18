// Alerts: tell the user when something goes wrong, wherever they want.
// Call notify(event, title, text). It never throws: a broken alert must never break a deploy.
import { randomBytes } from "node:crypto";
import { getSetting, setSetting } from "../lib/settings.ts";
import { config } from "../lib/config.ts";
import { sendEmail, type EmailChannel } from "./channels/email.ts";
import { sendDiscord, sendSlack, sendTelegram, sendWebhook, type DiscordChannel, type SlackChannel, type TelegramChannel, type WebhookChannel } from "./channels/chat.ts";

export type Channel = (EmailChannel | DiscordChannel | SlackChannel | TelegramChannel | WebhookChannel) & { id: string; name: string };

export const EVENTS = {
  deployFailed: "A deploy failed",
  appDown: "An app went down or keeps crashing",
  backupFailed: "A backup failed",
  cronFailed: "A cron job failed (after retries)",
  serverProblem: "A server problem (disk, HTTPS, services…)",
  resolved: "A problem was fixed",
} as const;
export type Event = keyof typeof EVENTS;

type Settings = { channels: Channel[]; events: Record<Event, boolean> };
const DEFAULTS: Settings = {
  channels: [],
  events: { deployFailed: true, appDown: true, backupFailed: true, cronFailed: true, serverProblem: true, resolved: true },
};

export const getAlerts = () => {
  const s = getSetting<Settings>("alerts", DEFAULTS);
  return { ...s, events: { ...DEFAULTS.events, ...s.events } };
};
export const saveAlerts = (s: Settings) => setSetting("alerts", s);
export const newChannelId = () => randomBytes(6).toString("hex");

async function send(ch: Channel, event: string, title: string, text: string, link?: string) {
  switch (ch.type) {
    case "email": return sendEmail(ch, `[Deploy Boat] ${title}`, `${text}${link ? `\n\n${link}` : ""}\n\n— Deploy Boat on ${config.publicIp}`);
    case "discord": return sendDiscord(ch, title, text, link);
    case "slack": return sendSlack(ch, title, text, link);
    case "telegram": return sendTelegram(ch, title, text, link);
    case "webhook": return sendWebhook(ch, event, title, text, link);
  }
}

export async function notify(event: Event, title: string, text: string, path = "") {
  try {
    const s = getAlerts();
    if (!s.events[event] || !s.channels.length) return;
    const link = `https://${config.dashboardHost}/${path}`;
    await Promise.all(s.channels.map((ch) => send(ch, event, title, text, link).catch((e) => console.error(`Alert to ${ch.name} failed:`, e.message))));
  } catch (e) {
    console.error("Alerts failed:", (e as Error).message);
  }
}

// "Send test" in the dashboard: this one does throw, so the user sees what's wrong.
export const testChannel = (ch: Channel) =>
  send(ch, "test", "Test alert", "If you can read this, alerts from Deploy Boat work.", `https://${config.dashboardHost}/`);
