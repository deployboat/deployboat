// Settings: your token and how to connect the CLI.
import { api, esc, icon, copy, toast, timeAgo } from "../app.js";
import { alertsSection } from "./alerts.js";

export async function settingsScreen(view) {
  const s = await api("/api/settings");
  view.innerHTML = `
    <div class="head"><h1>Settings</h1></div>
    <div class="card pad" style="display:grid;gap:18px">
      <div>
        <b>Main token</b>
        <p class="muted" style="margin:2px 0 10px">Full access, for logging in to this dashboard. Don't paste it into AI tools: use an agent token instead.</p>
        <div class="row"><input readonly type="password" value="${esc(s.token)}" id="tok" class="secret">
          <button class="btn" id="show">Show</button><button class="btn" id="ct">${icon("copy")}</button></div>
        <button class="btn danger" id="reset" style="margin-top:10px">${icon("restart")} Reset main token</button>
        <span class="note">Use this if it leaked. Agent tokens keep working.</span>
      </div>
      <div>
        <div class="row spread"><b>Agent tokens</b><button class="btn" id="newtok">${icon("plus")} New token</button></div>
        <p class="muted" style="margin:2px 0 10px">For the CLI and AI agents. They can deploy and read logs, but can't delete apps, change the server or read secrets.</p>
        <div id="newbox"></div>
        <div class="card list" id="toklist"></div>
      </div>
      <div id="mail"></div>
      <div id="alerts"></div>
      <div>
        <b>App addresses</b>
        <p class="muted" style="margin-top:2px">New apps get <code>&lt;name&gt;.${esc(s.baseDomain)}</code></p>
      </div>
    </div>`;

  view.querySelector("#ct").onclick = () => copy(s.token);
  view.querySelector("#reset").onclick = async () => {
    if (!confirm("Make a new main token?\n\nThe old one stops working right away. Other browsers are logged out, and any computer logged in with the main token must log in again. You stay logged in here.")) return;
    try {
      const r = await api("/api/settings/reset-token", { method: "POST" });
      s.token = r.token;
      const t = view.querySelector("#tok");
      t.value = r.token; t.type = "text";
      view.querySelector("#show").textContent = "Hide";
      toast("New main token created. Save it somewhere safe.");
    } catch (err) { toast(err.message); }
  };
  view.querySelector("#show").onclick = (e) => {
    const t = view.querySelector("#tok");
    t.type = t.type === "password" ? "text" : "password";
    e.target.textContent = t.type === "password" ? "Show" : "Hide";
  };

  drawTokens(view);
  alertsSection(view.querySelector("#alerts"));
  mailSection(view.querySelector("#mail"));
  view.querySelector("#newtok").onclick = () => {
    const box = view.querySelector("#newbox");
    box.innerHTML = `<form class="row" style="margin-bottom:10px"><input name="name" placeholder="Claude on my laptop" style="flex:1;min-width:180px" required autofocus>
      <button class="btn primary">Create</button></form>`;
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const r = await api("/api/tokens", { method: "POST", body: { name: e.target.name.value } });
      box.innerHTML = `<div class="card pad" style="margin-bottom:10px;background:var(--soft)">
        <b>${esc(r.name)}</b> <span class="note">Copy it now. It won't be shown again.</span>
        <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input readonly value="${esc(r.token)}" class="secret"><button class="btn" id="cp">${icon("copy")}</button></div></div>`;
      box.querySelector("#cp").onclick = () => copy(r.token);
      drawTokens(view);
    };
  };
}

async function drawTokens(view) {
  const list = await api("/api/tokens");
  const el = view.querySelector("#toklist");
  el.innerHTML = list.map((t) => `
    <div>
      <span class="grow"><b>${esc(t.name)}</b> <span class="muted">…${esc(t.hint)}</span></span>
      <span class="note">created ${timeAgo(t.created_at)} · ${t.last_used_at ? `used ${timeAgo(t.last_used_at)}` : "never used"}</span>
      <button class="btn danger" data-revoke="${t.id}">Revoke</button>
    </div>`).join("") || `<div class="muted">No agent tokens yet.</div>`;
  el.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Revoke this token? Anything using it stops working right away.")) return;
    await api(`/api/tokens/${b.dataset.revoke}`, { method: "DELETE" });
    toast("Revoked"); drawTokens(view);
  }));
}

// Email for apps: one SMTP provider that apps can opt into.
async function mailSection(el) {
  const m = await api("/api/settings/mail");
  el.innerHTML = `
    <b>Email for apps</b>
    <p class="muted" style="margin:2px 0 10px">Connect an email provider once (Resend, Postmark, Mailgun, Brevo, Gmail…).
      Apps that add email send through it. ${m ? `Connected: <b>${esc(m.host)}</b> as ${esc(m.from || m.user)}.` : "Not connected."}</p>
    <form class="form card pad" style="background:var(--bg)">
      <div class="row"><label style="flex:2">SMTP server<input name="host" value="${esc(m?.host ?? "")}" placeholder="smtp.resend.com" required></label>
        <label style="flex:1">Port<input name="port" type="number" value="${m?.port ?? 587}"></label></div>
      <div class="row"><label style="flex:1">Username<input name="user" value="${esc(m?.user ?? "")}" autocomplete="off"></label>
        <label style="flex:1">Password<input name="pass" type="password" placeholder="${m ? "unchanged" : ""}" autocomplete="new-password"></label></div>
      <div class="row"><label style="flex:1">Send as<input name="from" value="${esc(m?.from ?? "")}" placeholder="My App &lt;hello@yourdomain.com&gt;"></label>
        <label style="flex:1">Send a test to<input name="testTo" type="email" placeholder="you@example.com" required></label></div>
      <p class="note">Port 587 works almost everywhere. Some hosts (like Hetzner) block 25 and 465.</p>
      <div class="row" style="justify-content:flex-end">${m ? `<button type="button" class="btn danger" id="mailoff">Disconnect</button>` : ""}
        <button class="btn primary">Send test &amp; save</button></div>
    </form>`;
  const f = el.querySelector("form");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Sending test…";
    try { await api("/api/settings/mail", { method: "PUT", body: Object.fromEntries(new FormData(f)) }); toast("Test sent and saved"); mailSection(el); }
    catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Send test & save"; }
  };
  el.querySelector("#mailoff")?.addEventListener("click", async () => {
    if (!confirm("Disconnect the email provider? Apps that use email will fail to send until you connect one again.")) return;
    await api("/api/settings/mail", { method: "DELETE" }); toast("Disconnected"); mailSection(el);
  });
}
