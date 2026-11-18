// Settings: your token and how to connect the CLI.
import { api, esc, icon, copy, toast, timeAgo } from "../app.js";
import { alertsSection } from "./alerts.js";
import { dnsHelp, recordBox, wireCopy } from "./dns.js";

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
      <div id="domain"></div>
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
  domainSection(view.querySelector("#domain"));
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

// Your domain: *.example.com for every app, and (optionally) a separate dashboard address.
// The free nip.io addresses keep working whatever you choose here.
async function domainSection(el, pending) {
  if (!el.isConnected) return;
  const d = await api("/api/settings/domain");
  const own = !!d.base;
  // `pending`: a domain that was checked but not saved, because DNS isn't right yet.
  const checks = pending?.checks ?? d.checks;
  const baseVal = pending?.base ?? d.base;
  const dashVal = pending?.dashboard ?? d.dashboard;
  el.innerHTML = `
    <b>Your domain</b>
    <p class="muted" style="margin:2px 0 10px">${own
      ? `Apps live at <code>&lt;name&gt;.${esc(d.base)}</code>. Dashboard: <a href="https://${esc(d.dashboardHost)}">${esc(d.dashboardHost)}</a>.`
      : `Apps use free addresses like <code>&lt;name&gt;.${esc(d.nipDomain)}</code>. Use a domain you own to get <code>&lt;name&gt;.example.com</code> instead.`}
      The free addresses keep working as a backup, so you can't lock yourself out.</p>
    <form class="form card pad" style="background:var(--bg)">
      <label>Domain for apps
        <input name="base" value="${esc(baseVal)}" placeholder="example.com or apps.example.com" autocomplete="off">
        <span class="note">Every app gets a name under it: <code>blog.example.com</code>, <code>shop.example.com</code>…</span></label>
      ${checks?.base ? dnsHelp(checks.base) : !baseVal ? `<div><p class="note" style="margin-bottom:6px">You'll add one record where you bought the domain (it works for all apps):</p>
        ${recordBox({ type: "A", name: "*", value: d.ip })}</div>` : ""}
      <details ${dashVal ? "open" : ""}>
        <summary class="note" style="cursor:pointer">Dashboard address (optional)</summary>
        <label style="margin-top:8px">Dashboard at
          <input name="dashboard" value="${esc(dashVal)}" placeholder="${esc(baseVal ? `deployboat.${baseVal}` : "panel.example.com")}" autocomplete="off">
          <span class="note">Leave empty to use <code>deployboat.</code> + the domain above.</span></label>
        ${checks?.dashboard ? dnsHelp(checks.dashboard) : ""}
      </details>
      <div class="row" style="justify-content:flex-end">
        ${own ? `<button type="button" class="btn danger" id="domoff">Back to free addresses</button>` : ""}
        ${pending ? `<button type="button" class="btn" id="force">Save anyway</button>` : ""}
        <button class="btn primary">Check DNS &amp; save</button>
      </div>
    </form>`;
  wireCopy(el);
  const f = el.querySelector("form");

  const save = async (force) => {
    const body = { base: f.base.value, dashboard: f.dashboard.value, force };
    const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Checking DNS…";
    try {
      const r = await api("/api/settings/domain", { method: "PUT", body });
      if (!r.saved) { toast("Not saved yet: DNS needs a change. See below."); return domainSection(el, { ...body, checks: r.checks }); }
      toast("Saved. HTTPS for the new addresses is set up on the first visit.");
      if (r.dashboardHost !== location.host && confirm(`Saved. Open the dashboard at https://${r.dashboardHost} now?\n\nYou'll log in once more there, with the same token.`)) {
        location.href = `https://${r.dashboardHost}/`;
        return;
      }
      domainSection(el);
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Check DNS & save"; }
  };
  f.onsubmit = (e) => { e.preventDefault(); save(false); };
  el.querySelector("#force")?.addEventListener("click", () => {
    if (confirm("Save even though DNS isn't right yet?\n\nThe new addresses won't work until it is. The free addresses keep working.")) save(true);
  });
  el.querySelector("#domoff")?.addEventListener("click", async () => {
    if (!confirm(`Go back to the free addresses (…${d.nipDomain})?\n\nApp addresses under ${d.base} stop working. Apps' own domains (like myshop.com) are not affected.`)) return;
    await api("/api/settings/domain", { method: "PUT", body: { base: "", dashboard: "" } });
    toast("Back to the free addresses");
    if (location.host !== d.nipDashboard) location.href = `https://${d.nipDashboard}/#/settings`;
    else domainSection(el);
  });

  // While DNS isn't right, check again every 20 seconds.
  if (pending || (checks && Object.values(checks).some((c) => c && !c.ok))) {
    setTimeout(async () => {
      if (!el.isConnected || el.contains(document.activeElement)) return;
      if (!pending) return domainSection(el);
      const r = await api("/api/settings/domain", { method: "PUT", body: { base: pending.base, dashboard: pending.dashboard } }).catch(() => null);
      if (r?.saved) { toast("DNS is right now. Saved."); domainSection(el); }
      else if (r) domainSection(el, { ...pending, checks: r.checks });
    }, 20000);
  }
}
