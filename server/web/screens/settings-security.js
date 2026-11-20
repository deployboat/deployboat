// Settings → Security: the main token (full access) and agent tokens (limited, for the CLI and AI agents).
import { api, esc, icon, copy, toast, timeAgo } from "../app.js";

export async function securityPage(view) {
  const s = await api("/api/settings");
  view.innerHTML = `
    <div class="head"><h1>Security</h1>
      <p class="muted">Who can use this server: you with the main token, and your tools with agent tokens.</p></div>

    <div class="card pad setcard">
      <div class="sethead">
        <span class="tile">${icon("key")}</span>
        <div class="grow"><b>Main token</b>
          <p class="muted">Full access. It's what you log in with. Don't paste it into AI tools: give them an agent token instead.</p></div>
      </div>
      <div class="row" style="flex-wrap:nowrap">
        <input readonly type="password" value="${esc(s.token)}" id="tok" class="secret">
        <button class="btn" id="show">Show</button>
        <button class="btn" id="copytok" title="Copy">${icon("copy")}</button>
      </div>
      <div class="setfoot">
        <span class="note">Leaked, or shared it by mistake? Make a new one. Agent tokens keep working.</span>
        <button class="btn danger" id="reset">${icon("restart")} Reset main token</button>
      </div>
    </div>

    <div class="card setcard" style="margin-top:14px">
      <div class="sethead pad">
        <span class="tile">${icon("sparkle")}</span>
        <div class="grow"><b>Agent tokens</b>
          <p class="muted">For the CLI and AI agents. They can deploy, add services and read logs, but can't delete apps, change the server or read secrets.</p></div>
        <button class="btn primary" id="newtok">${icon("plus")} New token</button>
      </div>
      <div id="newbox"></div>
      <div class="list" id="toklist"></div>
    </div>`;

  // Main token: show/hide, copy, reset.
  const tok = view.querySelector("#tok");
  view.querySelector("#show").onclick = (e) => {
    tok.type = tok.type === "password" ? "text" : "password";
    e.target.textContent = tok.type === "password" ? "Show" : "Hide";
  };
  view.querySelector("#copytok").onclick = () => copy(tok.value);
  view.querySelector("#reset").onclick = async () => {
    if (!confirm("Make a new main token?\n\nThe old one stops working right away. Other browsers are logged out, and any computer logged in with the main token must log in again. You stay logged in here.")) return;
    try {
      const r = await api("/api/settings/reset-token", { method: "POST" });
      tok.value = r.token; tok.type = "text";
      view.querySelector("#show").textContent = "Hide";
      toast("New main token created. Save it somewhere safe.");
    } catch (err) { toast(err.message); }
  };

  // Agent tokens: create one, list them, revoke.
  view.querySelector("#newtok").onclick = () => newTokenForm(view);
  await drawTokens(view);
}

function newTokenForm(view) {
  const box = view.querySelector("#newbox");
  box.innerHTML = `
    <form class="row inset" style="flex-wrap:nowrap">
      <input name="name" placeholder="Name it after where you'll use it, like: Claude on my laptop" required autofocus>
      <button type="button" class="btn" data-x>Cancel</button>
      <button class="btn primary">Create</button>
    </form>`;
  box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/tokens", { method: "POST", body: { name: e.target.name.value } });
      box.innerHTML = `
        <div class="inset">
          <b>${esc(r.name)}</b> <span class="note">Copy it now. It won't be shown again.</span>
          <div class="row" style="margin-top:8px;flex-wrap:nowrap">
            <input readonly value="${esc(r.token)}" class="secret">
            <button class="btn" id="cp" title="Copy">${icon("copy")}</button>
            <button class="btn" data-x>Done</button>
          </div>
        </div>`;
      box.querySelector("#cp").onclick = () => copy(r.token);
      box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
      drawTokens(view);
    } catch (err) { toast(err.message); }
  };
}

async function drawTokens(view) {
  const list = await api("/api/tokens");
  const el = view.querySelector("#toklist");
  el.innerHTML = list.map((t) => `
    <div>
      <span class="grow"><b>${esc(t.name)}</b> <span class="muted secret">…${esc(t.hint)}</span>
        <div class="note">Created ${timeAgo(t.created_at)} · ${t.last_used_at ? `last used ${timeAgo(t.last_used_at)}` : "never used"}</div></span>
      <button class="btn danger" data-revoke="${t.id}">Revoke</button>
    </div>`).join("")
    || `<div class="muted">No agent tokens yet. Make one when you connect the CLI or an AI agent.</div>`;
  el.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Revoke this token? Anything using it stops working right away.")) return;
    await api(`/api/tokens/${b.dataset.revoke}`, { method: "DELETE" });
    toast("Revoked");
    drawTokens(view);
  }));
}
