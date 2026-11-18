// Alerts section of the Settings page: where to send alerts, and which ones.
import { api, esc, icon, toast } from "../app.js";

const TYPES = {
  email: { label: "Email", hint: "Any email provider (Gmail, Resend, Mailgun, Postmark…) through SMTP." },
  discord: { label: "Discord", hint: "Channel settings → Integrations → Webhooks → New Webhook → Copy URL." },
  slack: { label: "Slack", hint: "Create an Incoming Webhook (api.slack.com/apps → Incoming Webhooks) and copy its URL." },
  telegram: { label: "Telegram", hint: "Message @BotFather, send /newbot, and copy the token it gives you." },
  webhook: { label: "Webhook", hint: "We POST JSON { event, title, text, link } to this URL. Good for n8n, Zapier, Make…" },
};

export async function alertsSection(el) {
  const d = await api("/api/alerts");
  el.innerHTML = `
    <div class="row spread"><b>Alerts</b><button class="btn" id="addch">${icon("plus")} Add destination</button></div>
    <p class="muted" style="margin:2px 0 10px">Get told when something goes wrong, without opening this dashboard.</p>
    <div id="chform"></div>
    <div class="card list">${d.channels.map((c) => `
      <div>
        <span class="badge">${esc(TYPES[c.type]?.label ?? c.type)}</span>
        <span class="grow"><b>${esc(c.name)}</b> <span class="muted">${esc(c.label)}</span></span>
        <button class="btn" data-test="${c.id}">Send test</button>
        <button class="btn danger" data-del="${c.id}">${icon("trash")}</button>
      </div>`).join("") || `<div class="muted">No destinations yet. Alerts aren't sent anywhere.</div>`}
    </div>
    <div class="events">${Object.entries(d.eventNames).map(([k, label]) => `
      <label class="check"><input type="checkbox" data-ev="${k}" ${d.events[k] ? "checked" : ""}> ${esc(label)}</label>`).join("")}
    </div>`;

  el.querySelector("#addch").onclick = () => form(el.querySelector("#chform"), () => alertsSection(el));
  el.querySelectorAll("[data-test]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/alerts/channels/${b.dataset.test}/test`, { method: "POST" }); toast("Test sent"); }
    catch (err) { toast(err.message); }
    b.disabled = false;
  }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Remove this destination?")) return;
    await api(`/api/alerts/channels/${b.dataset.del}`, { method: "DELETE" }); toast("Removed"); alertsSection(el);
  }));
  el.querySelectorAll("[data-ev]").forEach((cb) => (cb.onchange = async () => {
    await api("/api/alerts/events", { method: "PUT", body: { [cb.dataset.ev]: cb.checked } }).catch((err) => toast(err.message));
  }));
}

function form(box, done) {
  let type = "email";
  const fields = {
    email: `
      <div class="row"><label style="flex:2">SMTP server<input name="host" placeholder="smtp.gmail.com" required></label>
        <label style="flex:1">Port<input name="port" type="number" value="587"></label></div>
      <div class="row"><label style="flex:1">Username<input name="user" autocomplete="off"></label>
        <label style="flex:1">Password<input name="pass" type="password" autocomplete="new-password"></label></div>
      <div class="row"><label style="flex:1">From<input name="from" placeholder="alerts@yourdomain.com"></label>
        <label style="flex:1">Send to<input name="to" placeholder="you@example.com" required></label></div>
      <p class="note">Gmail: use an App Password (Google Account → Security → App passwords), not your normal password.</p>`,
    discord: `<label>Webhook URL<input name="url" placeholder="https://discord.com/api/webhooks/…" required></label>`,
    slack: `<label>Webhook URL<input name="url" placeholder="https://hooks.slack.com/services/…" required></label>`,
    webhook: `<label>URL<input name="url" placeholder="https://…" required></label>`,
    telegram: `
      <label>Bot token<input name="token" placeholder="123456789:ABC…" required autocomplete="off"></label>
      <p class="note">Now open your new bot in Telegram and send it any message. Then:</p>
      <div class="row"><button type="button" class="btn" id="findchat">Find my chat</button><input name="chatId" placeholder="chat id" style="flex:1" required></div>`,
  };

  const draw = () => {
    box.innerHTML = `
      <form class="card pad form" style="margin-bottom:12px;background:var(--bg)">
        <div class="row" style="gap:6px">${Object.entries(TYPES).map(([k, t]) =>
          `<button type="button" class="btn ${k === type ? "primary" : ""}" data-type="${k}">${t.label}</button>`).join("")}</div>
        <p class="note">${TYPES[type].hint}</p>
        <label>Name<input name="name" value="${esc(TYPES[type].label)}" maxlength="40"></label>
        ${fields[type]}
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Cancel</button>
          <button class="btn primary">Send test &amp; save</button></div>
      </form>`;
    const f = box.querySelector("form");
    box.querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => { type = b.dataset.type; draw(); }));
    box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
    box.querySelector("#findchat")?.addEventListener("click", async () => {
      try {
        const r = await api("/api/alerts/telegram/find-chat", { method: "POST", body: { token: f.token.value } });
        f.chatId.value = r.chatId; toast(`Found: ${r.name || r.chatId}`);
      } catch (err) { toast(err.message); }
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Sending test…";
      try {
        await api("/api/alerts/channels", { method: "POST", body: { type, ...Object.fromEntries(new FormData(f)) } });
        toast("Test sent and saved"); box.innerHTML = ""; done();
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Send test & save"; }
    };
  };
  draw();
}
