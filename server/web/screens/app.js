// One app: Overview, Deploys, Logs, Variables.
import { api, esc, timeAgo, statusOf, icon, toast, copy } from "../app.js";

const TABS = [
  ["overview", "Overview", "box"],
  ["deploys", "Deploys", "list"],
  ["logs", "Logs", "term"],
  ["variables", "Variables", "key"],
];

export async function appScreen(view, name, tab) {
  const app = await api(`/api/apps/${encodeURIComponent(name)}`);
  const s = statusOf(app);
  view.innerHTML = `
    <a href="#/" class="btn" style="border:0;padding-left:0;margin-top:8px">${icon("back")} Apps</a>
    <div class="row spread head">
      <div class="row"><h1>${esc(name)}</h1><span class="status ${s}">${s}</span></div>
      <a class="btn" href="${esc(app.url)}" target="_blank">${icon("external")} Open</a>
    </div>
    <div class="tabs">${TABS.map(([id, label, ic]) =>
      `<a href="#/apps/${encodeURIComponent(name)}/${id}" class="${id === tab ? "on" : ""}">${icon(ic)}${label}</a>`).join("")}</div>
    <div id="tab"></div>`;

  const box = view.querySelector("#tab");
  const base = `/api/apps/${encodeURIComponent(name)}`;
  if (tab === "deploys") return deploys(box, base, app);
  if (tab === "logs") return logs(box, base);
  if (tab === "variables") return variables(box, base);
  return overview(box, base, app);
}

function overview(box, base, app) {
  box.innerHTML = `
    <div class="card pad">
      <dl class="info">
        <dt>Address</dt><dd><a href="${esc(app.url)}" target="_blank">${esc(app.url)}</a></dd>
        <dt>Files</dt><dd><a href="${esc(app.filesUrl)}" target="_blank">${esc(app.filesUrl)}</a></dd>
        <dt>Last deploy</dt><dd>${timeAgo(app.deploys[0]?.created_at)}</dd>
        <dt>Container</dt><dd>${esc(app.state)}</dd>
      </dl>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="restart">${icon("restart")} Restart</button>
      <button class="btn danger" id="delete">${icon("trash")} Delete app</button>
    </div>`;

  box.querySelector("#restart").onclick = async (e) => {
    e.target.disabled = true;
    try { await api(`${base}/restart`, { method: "POST" }); toast("Restarted"); }
    catch (err) { toast(err.message); }
    e.target.disabled = false;
  };
  box.querySelector("#delete").onclick = async () => {
    if (!confirm(`Delete ${app.name}? The site goes offline. Its database and files are kept.`)) return;
    try { await api(base, { method: "DELETE" }); toast("Deleted"); location.hash = "#/"; }
    catch (err) { toast(err.message); }
  };
}

function deploys(box, base, app) {
  if (!app.deploys.length) { box.innerHTML = `<div class="card pad muted">No deploys yet.</div>`; return; }
  box.innerHTML = `
    <div class="card list">${app.deploys.map((d) => `
      <button class="item" data-id="${d.id}">
        <span class="status ${d.status === "live" ? "live" : d.status}">${esc(d.status)}</span>
        <span class="grow muted">#${d.id}</span>
        <span class="muted">${timeAgo(d.created_at)}</span>
      </button>`).join("")}
    </div>
    <pre class="log" id="deploylog" style="margin-top:14px" hidden></pre>`;

  const pre = box.querySelector("#deploylog");
  box.querySelectorAll("[data-id]").forEach((b) => (b.onclick = async () => {
    const d = await api(`${base}/deploys/${b.dataset.id}`);
    pre.hidden = false;
    pre.textContent = d.log || "(empty log)";
    pre.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
}

// Live logs: refresh every 3 seconds, stay at the bottom unless you scrolled up.
async function logs(box, base) {
  box.innerHTML = `<pre class="log" id="applog">Loading…</pre>`;
  const pre = box.querySelector("#applog");
  async function load() {
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    pre.textContent = (await api(`${base}/logs`)) || "No output yet.";
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }
  await load();
  pre.scrollTop = pre.scrollHeight;
  const timer = setInterval(() => load().catch(() => {}), 3000);
  return () => clearInterval(timer);
}

async function variables(box, base) {
  const vars = await api(`${base}/env`);
  box.innerHTML = `
    <form class="card pad row" id="add" style="margin-bottom:12px">
      <input name="key" placeholder="NAME" style="flex:1;min-width:140px" required>
      <input name="value" placeholder="value" style="flex:2;min-width:180px">
      <button class="btn primary">${icon("plus")} Add</button>
    </form>
    <p class="muted" style="margin:0 2px 10px;font-size:13px">Saving restarts the app. ${icon("lock")} = created by Deploy Boat.</p>
    <div class="card list">${vars.map((v) => `
      <div>
        <code style="min-width:200px">${esc(v.key)}</code>
        <span class="grow secret muted" data-val="${esc(v.value)}">••••••••</span>
        <button class="btn" data-show>Show</button>
        <button class="btn" data-copy="${esc(v.value)}">${icon("copy")}</button>
        ${v.builtin ? `<span class="lock" title="Managed by Deploy Boat">${icon("lock")}</span>`
                    : `<button class="btn danger" data-del="${esc(v.key)}">${icon("trash")}</button>`}
      </div>`).join("") || `<div class="muted">No variables yet.</div>`}
    </div>`;

  const form = box.querySelector("#add");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`${base}/env`, { method: "PUT", body: { key: form.key.value.trim(), value: form.value.value } });
      toast("Saved"); variables(box, base);
    } catch (err) { toast(err.message); }
  };
  box.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => {
    const span = b.previousElementSibling, hidden = span.textContent.startsWith("•");
    span.textContent = hidden ? span.dataset.val : "••••••••";
    b.textContent = hidden ? "Hide" : "Show";
  }));
  box.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.del}? The app will restart.`)) return;
    try { await api(`${base}/env/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Removed"); variables(box, base); }
    catch (err) { toast(err.message); }
  }));
}
