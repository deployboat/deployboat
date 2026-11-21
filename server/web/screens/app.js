// One app. The sidebar picks the section; each section is a small function below.
import { api, esc, timeAgo, statusOf, icon, toast, copy } from "../app.js";
import { shareCard } from "./share.js";
import { crons } from "./crons.js";
import { lineChart, uptimeStrip } from "../chart.js";
import { rangePicker } from "./ranges.js";
import { bytes } from "../app.js";
import { filesPage } from "./files.js";
import { logsPage } from "./logs.js";
import { domainsPage } from "./domains.js";
import { storagePage } from "./storage.js";
import { databasePage } from "./database.js";

// [id, label, icon, soon?] — the sidebar is built from this list.
export const SECTIONS = [
  ["overview", "Overview", "home"],
  ["domains", "Domains", "globe"],
  ["storage", "Storage", "folder"],
  ["database", "Database", "db"],
  ["files", "Files", "file"],
  ["crons", "Crons", "clock"],
  ["versions", "Versions", "history"],
  ["logs", "Logs", "term"],
  ["variables", "Variables", "key"],
  ["settings", "Settings", "gear"],
];

export async function appScreen(view, name, section) {
  const app = await api(`/api/apps/${encodeURIComponent(name)}`);
  const s = statusOf(app);
  const title = SECTIONS.find(([id]) => id === section)?.[1] ?? "Overview";
  const host = app.url.replace(/^https:\/\//, "");
  const label = { live: "Live", stopped: "Stopped", failed: "Failed", building: "Building" }[s] ?? s;
  view.innerHTML = `
    <div class="apphead">
      <div class="apphead-title">
        <nav class="crumb"><a href="#/">Apps</a>${icon("chevron")}<span>${esc(app.displayName)}</span></nav>
        <h1>${title}</h1>
        <a class="apphead-url" href="${esc(app.url)}" target="_blank">${esc(host)}</a>
      </div>
      <div class="apphead-actions">
        <span class="statchip ${s}" title="Last deploy ${timeAgo(app.deploys[0]?.created_at)}"><span class="status ${s}"></span>${label}</span>
        <a class="btn" href="${esc(app.url)}" target="_blank">${icon("external")} Open site</a>
        <button class="btn" id="restart" ${app.stopped ? "disabled" : ""} title="Restart the app">${icon("restart")} Restart</button>
        ${app.stopped
          ? `<button class="btn primary" id="toggle">${icon("play")} Start</button>`
          : `<button class="btn" id="toggle" title="Stop the app; the site goes offline">${icon("stop")} Stop</button>`}
      </div>
    </div>
    <div id="section"></div>`;

  const box = view.querySelector("#section");
  const base = `/api/apps/${encodeURIComponent(name)}`;
  headerActions(view, base, app);
  const navTitle = document.querySelector(".navtitle");
  if (navTitle) navTitle.textContent = app.displayName;
  const show = { overview, versions, logs: logsPage, variables, database: databasePage, files: filesPage, storage, domains: domainsPage, crons, settings }[section] ?? overview;
  const stop = await show(box, base, app);
  return () => { stop?.(); box.stop?.(); };
}

// A label + value row with a copy button. Hidden values show dots until "Show".
export function field(label, value, { secret = false } = {}) {
  if (!value) return `<dt>${label}</dt><dd class="muted">—</dd>`;
  return `<dt>${label}</dt><dd class="row" style="gap:8px;flex-wrap:nowrap">
    <span class="grow secret" ${secret ? `data-val="${esc(value)}"` : ""}>${secret ? "••••••••" : esc(value)}</span>
    ${secret ? `<button class="btn" data-show>Show</button>` : ""}
    <button class="btn" data-copy="${esc(value)}">${icon("copy")}</button></dd>`;
}
export function wireFields(box) {
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
    ${app.previewOf ? `<div class="card pad banner">${icon("git")} Preview of <a href="#/apps/${encodeURIComponent(app.previewOf)}">${esc(app.previewOf)}</a> for pull request #${app.pr}.
      It's deleted, with its data, when the pull request is closed or merged.</div>` : ""}
    <div class="ovtop">
    <div class="card pad">
      <dl class="info">
        <dt>Address</dt><dd><a href="${esc(app.url)}" target="_blank">${esc(app.url)}</a></dd>
        ${app.filesUrl ? `<dt>Files</dt><dd><a href="${esc(app.filesUrl)}" target="_blank">${esc(app.filesUrl)}</a></dd>` : ""}
        <dt>Services</dt><dd>${app.services.length ? app.services.map((x) => ({ database: "Database", storage: "Storage" })[x]).join(", ") : `<span class="muted">None. Add a database or storage from the menu.</span>`}</dd>
        <dt>Persistent storage</dt><dd id="folders"></dd>
        <dt>Last deploy</dt><dd>${timeAgo(app.deploys[0]?.created_at)}</dd>
        <dt>Container</dt><dd>${esc(app.state)}</dd>
        ${app.git ? `<dt>Git</dt><dd>${esc(app.git.repo)} <span class="muted">(${esc(app.git.branch)})</span></dd>` : ""}
      </dl>
    </div>
    <div class="card pad sharecard" id="share"></div>
    </div>
    ${app.git ? `<div class="row" style="margin-top:14px"><button class="btn primary" id="redeploy">${icon("git")} Pull &amp; redeploy</button></div>` : ""}
    ${app.git && !app.git.isPreview ? autoDeployCard(app.git) : ""}`;

  const mon = document.createElement("div");
  box.append(mon);
  box.stop = monitoring(mon, app);
  persistentFolders(box.querySelector("#folders"), base, app);
  shareCard(box.querySelector("#share"), base).catch(() => {});
  wireAutoDeploy(box, base, app);
  box.querySelector("#redeploy")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api(`/api/git/redeploy/${encodeURIComponent(app.name)}`, { method: "POST" });
      toast("Deploy started");
      location.hash = `#/apps/${encodeURIComponent(app.name)}/versions`;
    } catch (err) { toast(err.message); }
  });
}

// Persistent storage on the Overview: the folders kept across deploys.
// /data is always there; the edit button lets you add or remove extra folders.
function persistentFolders(el, base, app) {
  let folders = app.folders;
  const show = () => {
    el.innerHTML = `
      <span class="row" style="gap:6px">${folders.map((f) => `<code class="tag">${esc(f)}</code>`).join("")}
        <button class="btn ghost sm" id="editfolders" title="Edit folders">${icon("edit")}</button></span>
      <div class="note" style="margin-top:4px">Files saved here survive deploys and are backed up.
        Everything else is reset on each deploy. <code>/data</code> is also in <code>DATA_DIR</code>.</div>`;
    el.querySelector("#editfolders").onclick = edit;
  };
  const edit = () => {
    const extra = folders.slice(1);
    const row = (v = "") => `<div class="row folderrow" style="flex-wrap:nowrap;gap:6px">
      <input name="f" value="${esc(v)}" placeholder="/app/uploads">
      <button type="button" class="btn ghost sm" data-rm title="Remove">${icon("x")}</button></div>`;
    el.innerHTML = `
      <form class="folderform">
        <div class="row" style="gap:6px"><code class="tag">/data</code><span class="note">always kept</span></div>
        <div id="extra">${extra.map(row).join("")}</div>
        <button type="button" class="linkbtn" id="addf">${icon("plus")} Add folder</button>
        <p class="note">Use the full path inside your app. Saving restarts the app.
          A new folder starts empty, so files your image already had at that path are hidden.</p>
        <div class="row" style="gap:6px"><button class="btn primary">Save &amp; restart</button>
          <button type="button" class="btn" data-x>Cancel</button></div>
      </form>`;
    const f = el.querySelector("form"), list = el.querySelector("#extra");
    const wire = () => list.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => b.parentElement.remove()));
    wire();
    el.querySelector("#addf").onclick = () => { list.insertAdjacentHTML("beforeend", row()); wire(); list.lastElementChild.querySelector("input").focus(); };
    el.querySelector("[data-x]").onclick = show;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        const r = await api(`${base}/folders`, { method: "PUT", body: { folders: [...f.querySelectorAll("[name=f]")].map((i) => i.value) } });
        folders = r.folders; toast("Saved. The app restarted with the new folders."); show();
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Save & restart"; }
    };
  };
  show();
}

// Uptime, response time, CPU and memory over time.
function monitoring(el, app) {
  let range = "24h", timer, stopped = false;
  async function draw() {
    const d = await api(`/api/metrics/apps/${encodeURIComponent(app.name)}?range=${range}`);
    if (stopped) return;
    const u = d.uptime;
    const avgMs = d.ms.length ? Math.round(d.ms.reduce((a, p) => a + p[1], 0) / d.ms.length) : null;
    el.innerHTML = `
      <div class="row spread" style="margin:22px 0 10px"><b>Monitoring</b><span id="ranges"></span></div>
      <div class="card pad" style="margin-bottom:10px">
        <div class="row spread"><span class="chart-title" style="margin:0">Uptime</span>
          <span><b>${u.percent === null ? "—" : `${u.percent}%`}</b> <span class="muted">${avgMs !== null ? `· ${avgMs} ms average response` : ""}</span></span></div>
        <div id="strip" style="margin-top:10px"></div>
        <p class="note" style="margin-top:6px">Checked every minute. Each block is a slice of the time range; hover for details.</p>
      </div>
      <div class="charts">
        <div class="card pad"><div class="chart-title">Response time</div><div data-c="ms"></div></div>
        <div class="card pad"><div class="chart-title">CPU</div><div data-c="cpu"></div></div>
        <div class="card pad"><div class="chart-title">Memory</div><div data-c="mem"></div></div>
      </div>`;
    rangePicker(el.querySelector("#ranges"), range, (r) => { range = r; clearTimeout(timer); draw(); });
    uptimeStrip(el.querySelector("#strip"), u);
    lineChart(el.querySelector('[data-c="ms"]'), d.ms, { format: (v) => `${Math.round(v)} ms` });
    lineChart(el.querySelector('[data-c="cpu"]'), d.cpu, { format: (v) => `${Math.round(v)}%` });
    lineChart(el.querySelector('[data-c="mem"]'), d.mem, { format: (v) => bytes(v) });
    timer = setTimeout(() => draw().catch(() => {}), 60000);
  }
  draw().catch(() => {});
  return () => { stopped = true; clearTimeout(timer); };
}

// Auto-deploy on push + pull request previews, with the webhook address to paste into GitHub etc.
function autoDeployCard(g) {
  return `
    <div class="card pad" style="margin-top:14px">
      <div class="row spread"><b>Auto-deploy</b>
        <label class="switch"><input type="checkbox" id="auto" ${g.autoDeploy ? "checked" : ""}><span></span> Deploy on every push to <code>${esc(g.branch)}</code></label></div>
      <p class="muted" style="font-size:13px;margin:6px 0 10px">Add this webhook address to your repo once. Keep it secret.</p>
      <div class="row" style="flex-wrap:nowrap"><input readonly value="${esc(g.webhookUrl)}" class="secret" id="hookurl">
        <button class="btn" id="cphook">${icon("copy")}</button><button class="btn" id="resethook" title="Make a new address">${icon("restart")}</button></div>
      <details class="guide" style="margin-top:10px">
        <summary class="note">Where do I paste it?</summary>
        <ul class="will" style="margin-top:8px;font-size:13.5px">
          <li><b>GitHub:</b> repo → Settings → Webhooks → Add webhook. Paste it as the Payload URL, content type <code>application/json</code>, choose "Let me select individual events" → <b>Pushes</b> and <b>Pull requests</b>.</li>
          <li><b>GitLab:</b> project → Settings → Webhooks. Paste the URL, tick <b>Push events</b> and <b>Merge request events</b>.</li>
          <li><b>Gitea / Forgejo:</b> repo → Settings → Webhooks → Add → Gitea. Paste the URL, choose push and pull request events.</li>
          <li><b>Bitbucket:</b> repo → Repository settings → Webhooks → Add. Paste the URL, trigger: Repository push.</li>
        </ul>
      </details>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <div class="row spread"><b>Pull request previews</b>
        <label class="switch"><input type="checkbox" id="prev" ${g.previews ? "checked" : ""}><span></span> Preview every pull request</label></div>
      <p class="muted" style="font-size:13px;margin-top:6px">Each pull request gets its own address${" "}(and its own empty database/storage if this app has them).
        Deleted when the pull request closes. GitHub, GitLab and Gitea. Pull requests from forks are ignored for safety.</p>
      ${g.previewApps.length ? `<div class="row" style="margin-top:10px;gap:6px">${g.previewApps.map((p) =>
        `<a class="btn" href="#/apps/${encodeURIComponent(p.name)}">#${p.pr}</a>`).join("")}</div>` : ""}
    </div>`;
}

function wireAutoDeploy(box, base, app) {
  if (!app.git || app.git.isPreview) return;
  const save = async (body, msg) => {
    try { const r = await api(`${base}/git`, { method: "PUT", body }); toast(msg); return r.git; }
    catch (err) { toast(err.message); }
  };
  box.querySelector("#auto").onchange = (e) => save({ autoDeploy: e.target.checked }, e.target.checked ? "Auto-deploy on" : "Auto-deploy off");
  box.querySelector("#prev").onchange = (e) => save({ previews: e.target.checked }, e.target.checked ? "Previews on" : "Previews off");
  box.querySelector("#cphook").onclick = () => copy(box.querySelector("#hookurl").value);
  box.querySelector("#resethook").onclick = async () => {
    if (!confirm("Make a new webhook address? The old one stops working, so update it in your repo settings.")) return;
    const g = await save({ resetSecret: true }, "New address created");
    if (g) box.querySelector("#hookurl").value = g.webhookUrl;
  };
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

// Danger zone at the bottom of the Database / Storage page.
export function removeServiceBox(box, base, app, service) {
  const db = service === "database";
  const el = document.createElement("div");
  el.className = "card pad danger-zone";
  el.style.marginTop = "14px";
  el.innerHTML = `
    <b>Delete ${db ? "database" : "storage"}</b>
    <p class="muted" style="font-size:13px;margin:2px 0 10px">${app.previewOf ? "Deletes this preview's data." :
      `Deletes ${db ? "every table and row" : "every stored file"}. A last backup is made first, so you can restore it from Backups.`}
      The app restarts without ${db ? "<code>DATABASE_URL</code>" : "the <code>S3_*</code> variables"}.</p>
    <button class="btn danger">${icon("trash")} Delete ${db ? "database" : "storage"}</button>`;
  box.append(el);
  el.querySelector("button").onclick = async (e) => {
    const typed = prompt(`This deletes ${app.displayName}'s ${db ? "database" : "stored files"}.\n\nType the app address name (${app.name}) to confirm:`);
    if (typed !== app.name) { if (typed !== null) toast("Name didn't match. Nothing deleted."); return; }
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span> Backing up and deleting…`;
    try { await api(`${base}/services/${service}`, { method: "DELETE" }); toast("Deleted"); dispatchEvent(new HashChangeEvent("hashchange")); }
    catch (err) { toast(err.message); b.disabled = false; b.textContent = `Delete ${db ? "database" : "storage"}`; }
  };
}

// Shown when an app hasn't added a service yet.
const SERVICE_TEXT = {
  storage: { icon: "folder", title: "No file storage yet", button: "Create storage", text: "Add S3-compatible storage for uploads and images. Your app gets <code>S3_*</code> variables and restarts." },
};

function addServicePage(box, base, service) {
  const t = SERVICE_TEXT[service];
  box.innerHTML = `
    <div class="card empty">
      ${icon(t.icon)}
      <h2>${t.title}</h2>
      <p class="muted" style="max-width:440px;margin:6px auto 18px">${t.text}</p>
      <button class="btn primary" id="addsvc">${icon("plus")} ${t.button}</button>
      <p class="note" style="margin-top:14px">AI agents can add it too: <code>deployboat add ${service}</code></p>
    </div>`;
  box.querySelector("#addsvc").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span> Adding…`;
    try { await api(`${base}/services/${service}`, { method: "POST" }); toast("Added"); dispatchEvent(new HashChangeEvent("hashchange")); }
    catch (err) {
      toast(err.message); b.disabled = false; b.textContent = t.button;
    }
  };
}

// Storage lives in storage.js. It needs addServicePage when the app has no storage yet.
const storage = (box, base, app) => storagePage(box, base, app, addServicePage);
