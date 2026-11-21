// Settings → Alerts: where alerts go (destinations), and which things to alert about.
import { api, esc, icon, toast } from "../app.js";
import { ask } from "../dialog.js";

// Every kind of destination: name, icon, and a hint on where to find what we ask for.
const TYPES = {
  email: { label: "Email", icon: "mail", hint: "Any email provider (Gmail, Resend, Mailgun, Postmark…) through SMTP." },
  discord: { label: "Discord", icon: "chat", hint: "In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL." },
  slack: { label: "Slack", icon: "chat", hint: "Create an Incoming Webhook (api.slack.com/apps → Incoming Webhooks) and copy its URL." },
  telegram: { label: "Telegram", icon: "send", hint: "Message @BotFather in Telegram, send /newbot, and copy the token it gives you." },
  webhook: { label: "Webhook", icon: "link", hint: "We POST JSON { event, title, text, link } to this URL. Good for n8n, Zapier, Make…" },
};

// The events, grouped, with a short explanation of when each one is sent.
// The names come from the server; this only adds the grouping and the explanations.
const GROUPS = [
  ["Apps", [
    ["deployFailed", "When a build or start fails. The old version keeps running."],
    ["appDown", "When an app stops answering for 3 minutes, or keeps restarting."],
    ["cronFailed", "When a scheduled job still fails after its retries."],
  ]],
  ["Server", [
    ["backupFailed", "When a nightly backup, or its off-server copy, doesn't work."],
    ["serverProblem", "When Server Doctor finds something: disk filling up, HTTPS, updates…"],
  ]],
  ["Good news", [
    ["resolved", "When one of the problems above is fixed again."],
  ]],
];

export async function alertsPage(view) {
  const d = await api("/api/alerts");
  view.innerHTML = `
    <p class="muted tabintro">Get told when something goes wrong, without keeping this dashboard open.</p>

    <div class="card setcard">
      <div class="sethead pad">
        <span class="tile">${icon("send")}</span>
        <div class="grow"><b>Where alerts go</b>
          <p class="muted">Every alert goes to all of these.</p></div>
        <button class="btn primary" id="add">${icon("plus")} Add destination</button>
      </div>
      <div id="form"></div>
      <div class="list">${d.channels.map(destinationRow).join("")
        || `<div class="muted">No destinations yet, so alerts aren't sent anywhere. Add one to start.</div>`}</div>
    </div>

    <div class="card setcard" style="margin-top:14px">
      <div class="sethead pad">
        <span class="tile">${icon("alert")}</span>
        <div class="grow"><b>What to alert about</b>
          <p class="muted">Turn off what you don't want to hear about. Changes save right away.</p></div>
      </div>
      ${GROUPS.map(([group, events]) => `
        <div class="evgroup">${esc(group)}</div>
        <div class="list">${events.map(([key, why]) => `
          <label class="evrow">
            <span class="grow"><b>${esc(d.eventNames[key] ?? key)}</b><span class="note">${esc(why)}</span></span>
            <span class="switch"><input type="checkbox" data-ev="${key}" ${d.events[key] ? "checked" : ""}><span></span></span>
          </label>`).join("")}</div>`).join("")}
    </div>`;

  view.querySelector("#add").onclick = () => addForm(view.querySelector("#form"), () => alertsPage(view));

  view.querySelectorAll("[data-test]").forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = "Sending…";
    try { await api(`/api/alerts/channels/${b.dataset.test}/test`, { method: "POST" }); toast("Test sent"); }
    catch (err) { toast(err.message, "error"); }
    b.disabled = false; b.textContent = "Send test";
  }));

  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!(await ask({ title: "Remove this destination?", text: "Alerts stop going there.", ok: "Remove", danger: true }))) return;
    await api(`/api/alerts/channels/${b.dataset.del}`, { method: "DELETE" });
    toast("Removed");
    alertsPage(view);
  }));

  view.querySelectorAll("[data-ev]").forEach((cb) => (cb.onchange = async () => {
    try {
      await api("/api/alerts/events", { method: "PUT", body: { [cb.dataset.ev]: cb.checked } });
      toast(cb.checked ? "Turned on" : "Turned off");
    } catch (err) { toast(err.message, "error"); cb.checked = !cb.checked; }
  }));
}

function destinationRow(c) {
  const t = TYPES[c.type] ?? { label: c.type, icon: "link" };
  return `
    <div>
      <span class="tile sm">${icon(t.icon)}</span>
      <span class="grow"><b>${esc(c.name)}</b><div class="note">${esc(t.label)} · ${esc(c.label)}</div></span>
      <button class="btn" data-test="${c.id}">Send test</button>
      <button class="btn danger" data-del="${c.id}" title="Remove">${icon("trash")}</button>
    </div>`;
}

// The "Add destination" form. Pick a type, fill in its fields, and we save it only if a test gets through.
function addForm(box, done) {
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
      <div class="row" style="flex-wrap:nowrap"><button type="button" class="btn" id="findchat">Find my chat</button>
        <input name="chatId" placeholder="chat id" required></div>`,
  };

  const draw = () => {
    box.innerHTML = `
      <form class="form inset">
        <div class="typepick">${Object.entries(TYPES).map(([k, t]) => `
          <button type="button" class="choice ${k === type ? "on" : ""}" data-type="${k}">${icon(t.icon)}<b>${t.label}</b></button>`).join("")}</div>
        <p class="note">${TYPES[type].hint}</p>
        <label>Name<input name="name" value="${esc(TYPES[type].label)}" maxlength="40"></label>
        ${fields[type]}
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="btn" data-x>Cancel</button>
          <button class="btn primary">Send test &amp; save</button>
        </div>
      </form>`;
    const f = box.querySelector("form");
    box.querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => { type = b.dataset.type; draw(); }));
    box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
    box.querySelector("#findchat")?.addEventListener("click", async () => {
      try {
        const r = await api("/api/alerts/telegram/find-chat", { method: "POST", body: { token: f.token.value } });
        f.chatId.value = r.chatId;
        toast(`Found: ${r.name || r.chatId}`);
      } catch (err) { toast(err.message, "error"); }
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Sending test…";
      try {
        await api("/api/alerts/channels", { method: "POST", body: { type, ...Object.fromEntries(new FormData(f)) } });
        toast("Test sent and saved");
        done();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; btn.textContent = "Send test & save"; }
    };
  };
  draw();
}
