// One app. The sidebar picks the section; each section is a small function below.
import { api, esc, timeAgo, statusOf, icon, toast, copy } from "../app.js";
import { share } from "./share.js";
import { crons } from "./crons.js";

// [id, label, icon, soon?] — the sidebar is built from this list.
export const SECTIONS = [
  ["overview", "Overview", "home"],
  ["versions", "Versions", "history"],
  ["logs", "Logs", "term"],
  ["variables", "Variables", "key"],
  ["database", "Database", "db"],
  ["storage", "Storage", "folder"],
  ["settings", "Settings", "gear"],
  ["domains", "Domains", "globe"],
  ["share", "Share", "share"],
  ["crons", "Crons", "clock"],
];

export async function appScreen(view, name, section) {
  const app = await api(`/api/apps/${encodeURIComponent(name)}`);
  const s = statusOf(app);
  const title = SECTIONS.find(([id]) => id === section)?.[1] ?? "Overview";
  view.innerHTML = `
    <div class="row spread head">
      <div><div class="muted" style="font-size:13px">${esc(app.displayName)}</div>
        <div class="row"><h1>${title}</h1><span class="status ${s}">${s}</span></div></div>
      <div class="row" style="gap:8px">
        <a class="btn" href="${esc(app.url)}" target="_blank">${icon("external")} Open site</a>
        ${app.stopped
          ? `<button class="btn primary" id="toggle">${icon("play")} Start</button>`
          : `<button class="btn" id="toggle">${icon("stop")} Stop</button>`}
        <button class="btn" id="restart" ${app.stopped ? "disabled" : ""}>${icon("restart")} Restart</button>
      </div>
    </div>
    <div id="section"></div>`;

  const box = view.querySelector("#section");
  const base = `/api/apps/${encodeURIComponent(name)}`;
  headerActions(view, base, app);
  const navTitle = document.querySelector(".navtitle");
  if (navTitle) navTitle.textContent = app.displayName;
  const show = { overview, versions, logs, variables, database, storage, domains, share, crons, settings }[section] ?? overview;
  const stop = await show(box, base, app);
  return () => { stop?.(); box.stop?.(); };
}

// A label + value row with a copy button. Hidden values show dots until "Show".
function field(label, value, { secret = false } = {}) {
  if (!value) return `<dt>${label}</dt><dd class="muted">—</dd>`;
  return `<dt>${label}</dt><dd class="row" style="gap:8px;flex-wrap:nowrap">
    <span class="grow secret" ${secret ? `data-val="${esc(value)}"` : ""}>${secret ? "••••••••" : esc(value)}</span>
    ${secret ? `<button class="btn" data-show>Show</button>` : ""}
    <button class="btn" data-copy="${esc(value)}">${icon("copy")}</button></dd>`;
}
function wireFields(box) {
  box.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  box.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => {
    const span = b.previousElementSibling, hidden = span.textContent.startsWith("•");
    span.textContent = hidden ? span.dataset.val : "••••••••";
    b.textContent = hidden ? "Hide" : "Show";
  }));
}

// Stop/Start and Restart live in the page header, on every section.
function headerActions(view, base, app) {
  const redraw = () => dispatchEvent(new HashChangeEvent("hashchange"));
  view.querySelector("#restart").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await api(`${base}/restart`, { method: "POST" }); toast("Restarted"); }
    catch (err) { toast(err.message); }
    b.disabled = false;
  };
  view.querySelector("#toggle").onclick = async (e) => {
    const action = app.stopped ? "start" : "stop";
    if (action === "stop" && !confirm(`Stop ${app.name}? The site goes offline until you start it again.`)) return;
    const b = e.currentTarget; b.disabled = true;
    try { await api(`${base}/${action}`, { method: "POST" }); toast(action === "stop" ? "Stopped" : "Started"); redraw(); }
    catch (err) { toast(err.message); b.disabled = false; }
  };
}

function overview(box, base, app) {
  box.innerHTML = `
    <div class="card pad">
      <dl class="info">
        <dt>Address</dt><dd><a href="${esc(app.url)}" target="_blank">${esc(app.url)}</a></dd>
        <dt>Files</dt><dd><a href="${esc(app.filesUrl)}" target="_blank">${esc(app.filesUrl)}</a></dd>
        <dt>Last deploy</dt><dd>${timeAgo(app.deploys[0]?.created_at)}</dd>
        <dt>Container</dt><dd>${esc(app.state)}</dd>
        ${app.git ? `<dt>Git</dt><dd>${esc(app.git.repo)} <span class="muted">(${esc(app.git.branch)})</span></dd>` : ""}
      </dl>
    </div>
    ${app.git ? `<div class="row" style="margin-top:14px"><button class="btn primary" id="redeploy">${icon("git")} Pull &amp; redeploy</button></div>` : ""}`;

  box.querySelector("#redeploy")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api(`/api/git/redeploy/${encodeURIComponent(app.name)}`, { method: "POST" });
      toast("Deploy started");
      location.hash = `#/apps/${encodeURIComponent(app.name)}/versions`;
    } catch (err) { toast(err.message); }
  });
}

// App settings: name, delete. (The address is on the Domains page.)
function settings(box, base, app) {
  box.innerHTML = `
    <form class="card pad" id="dname">
      <b>App name</b>
      <p class="muted" style="font-size:13px;margin:2px 0 10px">Only shown in the dashboard. To change the web address, go to Domains.</p>
      <div class="row"><input name="displayName" value="${esc(app.displayName)}" maxlength="60" style="flex:1;min-width:180px" required>
        <button class="btn primary">Save</button></div>
    </form>
    <div class="card pad danger-zone" style="margin-top:14px">
      <b>Delete app</b>
      <p class="muted" style="font-size:13px;margin:2px 0 10px">Takes the site offline and removes it from Deploy Boat. Its database and files are kept.</p>
      <button class="btn danger" id="delete">${icon("trash")} Delete ${esc(app.displayName)}</button>
    </div>`;

  const form = box.querySelector("#dname");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`${base}/display-name`, { method: "PUT", body: { displayName: form.displayName.value } });
      toast("Saved");
      dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (err) { toast(err.message); }
  };
  box.querySelector("#delete").onclick = async () => {
    if (!confirm(`Delete ${app.displayName}? The site goes offline. Its database and files are kept.`)) return;
    try { await api(base, { method: "DELETE" }); toast("Deleted"); location.hash = "#/"; }
    catch (err) { toast(err.message); }
  };
}

// Domains: change the free address, add your own domains.
async function domains(box, base, app) {
  const d = await api(`${base}/domains`);
  box.innerHTML = `
    <form class="card pad" id="address">
      <b>Free address</b>
      <p class="muted" style="font-size:13px;margin:2px 0 10px">Always works, HTTPS included. Changing it keeps your database, files and project folder working.</p>
      <div class="row" style="flex-wrap:nowrap">
        <input name="name" value="${esc(app.name)}" pattern="[a-z0-9][a-z0-9\-]*" required style="flex:1;min-width:100px">
        <span class="muted" style="white-space:nowrap">.${esc(d.baseDomain)}</span>
        <button class="btn primary">Change</button>
      </div>
    </form>

    <div class="card" style="margin-top:14px">
      <div class="pad" style="padding-bottom:0">
        <b>Your own domains</b>
        <p class="muted" style="font-size:13px;margin:2px 0 12px">Use a domain you own, like <code>myshop.com</code>. HTTPS is set up automatically.</p>
        <form class="row" id="add" style="margin-bottom:16px">
          <input name="host" placeholder="myshop.com" style="flex:1;min-width:180px" required autocomplete="off">
          <button class="btn primary">${icon("plus")} Add domain</button>
        </form>
      </div>
      <div class="list" style="border-top:1px solid var(--line)">${d.custom.map((x) => `
        <div>
          <span class="status ${x.ready ? "live" : "building"}">${x.ready ? "Connected" : "Waiting for DNS"}</span>
          <a class="grow" href="https://${esc(x.host)}" target="_blank" style="text-decoration:none">${esc(x.host)}</a>
          <button class="btn danger" data-del="${esc(x.host)}">${icon("trash")}</button>
        </div>`).join("") || `<div class="muted">No domains yet.</div>`}
      </div>
    </div>

    ${d.custom.some((x) => !x.ready) || !d.custom.length ? `
    <div class="card pad" style="margin-top:14px">
      <b>How to connect a domain</b>
      <ol class="steps" style="margin-top:10px">
        <li>Open the DNS settings where you bought the domain (Namecheap, GoDaddy, Cloudflare…).</li>
        <li>Add an <b>A record</b>: name <code>@</code> (or <code>www</code>), value <code>${esc(d.ip)}</code>.</li>
        <li>Wait a few minutes. The status here turns to <b>Connected</b> by itself.</li>
      </ol>
      <p class="note" style="margin-top:10px">Using Cloudflare? Set the record to "DNS only" (grey cloud) so HTTPS can be set up.</p>
    </div>` : ""}`;

  box.querySelector("#address").onsubmit = async (e) => {
    e.preventDefault();
    const newName = e.target.name.value.trim().toLowerCase();
    if (newName === app.name) return;
    if (!confirm(`Change the address to ${newName}.${d.baseDomain}? The old address stops working.`)) return;
    try {
      const r = await api(`${base}/rename`, { method: "POST", body: { newName } });
      toast("Address changed");
      location.hash = `#/apps/${encodeURIComponent(r.name)}/domains`;
    } catch (err) { toast(err.message); }
  };
  box.querySelector("#add").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`${base}/domains`, { method: "POST", body: { host: e.target.host.value } });
      toast(r.ready ? "Domain connected" : "Added. Now point its DNS to your server.");
      domains(box, base, app);
    } catch (err) { toast(err.message); }
  };
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.del}?`)) return;
    try { await api(`${base}/domains/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Removed"); domains(box, base, app); }
    catch (err) { toast(err.message); }
  }));

  // Check DNS again every 15 seconds while a domain is waiting.
  if (d.custom.some((x) => !x.ready)) {
    const timer = setTimeout(() => box.isConnected && domains(box, base, app), 15000);
    box.stop = () => clearTimeout(timer);
  }
}

// Each version is a collapsible row. Opening it loads its build log.
// While a version is building, it stays open and its log updates live.
function versions(box, base, app) {
  if (!app.deploys.length) { box.innerHTML = `<div class="card pad muted">No versions yet.</div>`; return; }
  box.innerHTML = `<div class="card">${app.deploys.map((d) => `
    <details class="ver" data-id="${d.id}">
      <summary>
        <span class="chev">${icon("chevron")}</span>
        <span class="status ${esc(d.status)}">${esc(d.status)}</span>
        <span class="grow">Version #${d.id} ${d.current ? `<span class="badge">Running</span>` : ""}</span>
        <span class="muted">${timeAgo(d.created_at)}</span>
      </summary>
      <div class="verbody">
        ${d.current ? "" : d.canActivate
          ? `<div><button class="btn" data-use="${d.id}">${icon("history")} Roll back to this version</button></div>`
          : `<div class="row"><button class="btn" disabled>${icon("history")} Roll back</button>
             <span class="note">${d.status === "live" ? "Made before rollback existed, can't be restored." : "This version didn't build, so there's nothing to restore."}</span></div>`}
        <pre class="log">Loading log…</pre>
      </div>
    </details>`).join("")}</div>`;

  // Live view of a version that's still building.
  const building = app.deploys.find((d) => d.status === "building");
  if (building) {
    const el = box.querySelector(`details[data-id="${building.id}"]`);
    el.open = true;
    const pre = el.querySelector("pre");
    pre.dataset.loaded = "1";
    const timer = setInterval(async () => {
      try {
        const d = await api(`${base}/deploys/${building.id}`);
        const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
        pre.textContent = d.log || "Starting…";
        if (atBottom) pre.scrollTop = pre.scrollHeight;
        if (d.status !== "building") { clearInterval(timer); versions(box, base, await api(base)); }
      } catch { clearInterval(timer); }
    }, 2000);
    box.stop = () => clearInterval(timer);
  }

  box.querySelectorAll("details.ver").forEach((el) => el.addEventListener("toggle", async () => {
    const pre = el.querySelector("pre");
    if (!el.open || pre.dataset.loaded) return;
    const d = await api(`${base}/deploys/${el.dataset.id}`);
    pre.textContent = d.log || "(empty log)";
    pre.dataset.loaded = "1";
  }));
  box.querySelectorAll("[data-use]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Switch the live site to version #${b.dataset.use}?`)) return;
    b.disabled = true;
    try {
      await api(`${base}/versions/${b.dataset.use}/activate`, { method: "POST" });
      toast(`Now running version #${b.dataset.use}`);
      versions(box, base, await api(base));
    } catch (err) { toast(err.message); b.disabled = false; }
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
        ${v.builtin ? `<span class="muted" title="Managed by Deploy Boat">${icon("lock")}</span>`
                    : `<button class="btn danger" data-del="${esc(v.key)}">${icon("trash")}</button>`}
      </div>`).join("") || `<div class="muted">No variables yet.</div>`}
    </div>`;

  wireFields(box);
  const form = box.querySelector("#add");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`${base}/env`, { method: "PUT", body: { key: form.key.value.trim(), value: form.value.value } });
      toast("Saved"); variables(box, base);
    } catch (err) { toast(err.message); }
  };
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.del}? The app will restart.`)) return;
    try { await api(`${base}/env/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Removed"); variables(box, base); }
    catch (err) { toast(err.message); }
  }));
}

async function database(box, base) {
  const db = await api(`${base}/database`);
  const rows = db.tables.reduce((n, t) => n + t.rows, 0);
  box.innerHTML = `
    <div class="stats">
      <div class="card stat"><b>${db.tables.length}</b><span>tables</span></div>
      <div class="card stat"><b>${rows.toLocaleString()}</b><span>rows (approx.)</span></div>
      <div class="card stat"><b>PostgreSQL 17</b><span>engine</span></div>
    </div>
    <div class="card pad" style="margin-bottom:14px">
      <dl class="info">${field("DATABASE_URL", db.url, { secret: true })}</dl>
      <p class="muted" style="font-size:13px;margin-top:10px">Your app already has this as <code>DATABASE_URL</code>. Only reachable from apps on this server.</p>
    </div>
    <div class="card list">${db.tables.map((t) => `
      <div><span>${icon("db")}</span><code class="grow">${esc(t.table)}</code><span class="muted">${t.rows.toLocaleString()} rows</span></div>`).join("")
      || `<div class="muted">No tables yet. They appear here when your app creates them.</div>`}
    </div>`;
  wireFields(box);
}

async function storage(box, base) {
  const s = await api(`${base}/storage`);
  box.innerHTML = `
    <div class="stats">
      <div class="card stat"><b>${s.objects.toLocaleString()}</b><span>files</span></div>
      <div class="card stat"><b>${esc(s.size)}</b><span>used</span></div>
      <div class="card stat"><b>S3</b><span>compatible</span></div>
    </div>
    <div class="card pad">
      <dl class="info">
        ${field("Public URL", s.publicUrl)}
        ${field("Bucket", s.bucket)}
        ${field("Endpoint", s.endpoint)}
        ${field("Access key", s.accessKey)}
        ${field("Secret key", s.secretKey, { secret: true })}
      </dl>
      <p class="muted" style="font-size:13px;margin-top:12px">Your app already has these as <code>S3_*</code> variables. Uploaded files are public at
        <code>${esc(s.publicUrl)}/&lt;file&gt;</code>. In S3 SDKs set <code>forcePathStyle: true</code>.</p>
    </div>`;
  wireFields(box);
}
