// Settings: your token and how to connect the CLI.
import { api, esc, icon, copy } from "../app.js";

export async function settingsScreen(view) {
  const s = await api("/api/settings");
  const login = `npx deployboat login ${s.dashboard} ${s.token}`;
  view.innerHTML = `
    <div class="head"><h1>Settings</h1></div>
    <div class="card pad" style="display:grid;gap:18px">
      <div>
        <b>Connect your computer</b>
        <p class="muted" style="margin:2px 0 10px">Run this once, then <code>npx deployboat deploy</code> in any project.</p>
        <div class="row"><input readonly value="${esc(login)}" class="secret"><button class="btn" id="cl">${icon("copy")} Copy</button></div>
      </div>
      <div>
        <b>Token</b>
        <p class="muted" style="margin:2px 0 10px">Keep it secret. Anyone with it can deploy to this server.</p>
        <div class="row"><input readonly type="password" value="${esc(s.token)}" id="tok" class="secret">
          <button class="btn" id="show">Show</button><button class="btn" id="ct">${icon("copy")}</button></div>
      </div>
      <div>
        <b>App addresses</b>
        <p class="muted" style="margin-top:2px">New apps get <code>&lt;name&gt;.${esc(s.baseDomain)}</code></p>
      </div>
    </div>`;

  view.querySelector("#cl").onclick = () => copy(login);
  view.querySelector("#ct").onclick = () => copy(s.token);
  view.querySelector("#show").onclick = (e) => {
    const t = view.querySelector("#tok");
    t.type = t.type === "password" ? "text" : "password";
    e.target.textContent = t.type === "password" ? "Show" : "Hide";
  };
}
