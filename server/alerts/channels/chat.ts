// Discord, Slack, Telegram and plain webhooks: one HTTP POST each.
export type DiscordChannel = { type: "discord"; url: string };
export type SlackChannel = { type: "slack"; url: string };
export type TelegramChannel = { type: "telegram"; token: string; chatId: string };
export type WebhookChannel = { type: "webhook"; url: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`It answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 150)}`);
}

export const sendDiscord = (ch: DiscordChannel, title: string, text: string, link?: string) =>
  post(ch.url, { content: `**${title}**\n${text}${link ? `\n${link}` : ""}`.slice(0, 2000) });

export const sendSlack = (ch: SlackChannel, title: string, text: string, link?: string) =>
  post(ch.url, { text: `*${title}*\n${text}${link ? `\n<${link}|Open Deploy Boat>` : ""}` });

export const sendTelegram = (ch: TelegramChannel, title: string, text: string, link?: string) =>
  post(`https://api.telegram.org/bot${ch.token}/sendMessage`, {
    chat_id: ch.chatId, text: `${title}\n\n${text}${link ? `\n${link}` : ""}`.slice(0, 4000), disable_web_page_preview: true,
  });

export const sendWebhook = (ch: WebhookChannel, event: string, title: string, text: string, link?: string) =>
  post(ch.url, { source: "deployboat", event, title, text, link, at: new Date().toISOString() });

// Telegram: after the user sends any message to their bot, find their chat id.
export async function findTelegramChat(token: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({})) as any;
  if (!data.ok) throw new Error(data.description === "Unauthorized" ? "That bot token isn't right." : (data.description ?? "Telegram didn't answer."));
  const chat = [...(data.result ?? [])].reverse().map((u: any) => u.message?.chat ?? u.channel_post?.chat).find(Boolean);
  if (!chat) throw new Error("No messages yet. Open your bot in Telegram, send it any message, then try again.");
  return { chatId: String(chat.id), name: chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? chat.username };
}
