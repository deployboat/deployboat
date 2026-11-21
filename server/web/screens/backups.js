// Backups: summary, schedule, off-server copy (S3 or Google Drive), and every backup with restore/download.
//
// The page is drawn once. After that, only the parts that change (summary, progress, list)
// are refreshed, so forms you're typing in are never wiped by a refresh.
import { api, esc, icon, toast, timeAgo, bytes, copy } from "../app.js";
import { ask, askTyped } from "../dialog.js";

export async function backupsScreen(view) {
  let d = await api("/api/backups");
  let timer;
  const restoring = new Set(); // backup ids being restored right now (kept across refreshes)

  view.innerHTML = `
    <div class="row spread head">
      <div><h1>Backups</h1><p class="muted">Your apps' databases and stored files, saved every night.</p></div>
      <button class="btn primary" id="now"></button>
    </div>
    <div class="stats" id="summary"></div>
    <div id="progress"></div>
    <div class="bk-setup">
      <form class="card pad" id="schedule"></form>
      <div class="card pad" id="remote"></div>
    </div>
    <div id="list"></div>`;

  // --- the parts that refresh ------------------------------------------------

  function drawLive() {
    const btn = view.querySelector("#now");
    btn.disabled = d.running;
    btn.innerHTML = d.running ? `<span class="spinner sm"></span> Backing up…` : `${icon("save")} Back up now`;
    view.querySelector("#summary").innerHTML = summary(d);
    view.querySelector("#progress").innerHTML = progress(d);
    view.querySelector("#list").innerHTML = list(d, restoring);
  }

  // Ask the server again: every 2 seconds while a backup runs, otherwise every 30.
  async function refresh() {
    clearTimeout(timer);
    try { d = await api("/api/backups"); drawLive(); } catch { /* try again next time */ }
    timer = setTimeout(refresh, d.running ? 2000 : 30000);
  }

  // --- the parts drawn once (redrawn only after you change them) ---------------

  function drawSchedule() {
    const s = d.settings;
    const f = view.querySelector("#schedule");
    f.innerHTML = `
      <div class="row spread"><b>Schedule</b>
        <label class="switch"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}><span></span></label></div>
      <p class="muted bk-sub">${s.enabled ? `Every night, for apps with a database or storage.` : "Off. Only manual backups are made."}</p>
      <div class="row bk-fields">
        <label>Time<input type="time" name="time" value="${esc(s.time)}"></label>
        <label>Keep the last<span class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" name="keep" min="1" max="60" value="${s.keep}"> per app</span></label>
      </div>
      <div class="row spread" style="margin-top:12px">
        <span class="note">Time zone: ${esc(s.timezone)}</span>
        <button class="btn">Save</button>
      </div>`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        d.settings = await api("/api/backups/settings", { method: "PUT", body: {
          enabled: f.enabled.checked, time: f.time.value, keep: Number(f.keep.value),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        } });
        toast("Saved");
        drawSchedule(); drawLive();
      } catch (err) { toast(err.message, "error"); }
    };
  }

  function drawRemote() {
    const s = d.settings;
    const el = view.querySelector("#remote");
    el.innerHTML = s.remote ? `
      <b>Off-server copy</b>
      <p class="muted bk-sub">Every backup is also copied here, so it survives if this server doesn't.</p>
      <div class="row bk-dest">
        <span class="tile">${icon(s.remoteType === "gdrive" ? "drive" : "cloud")}</span>
        <span class="grow"><b>${s.remoteType === "gdrive" ? "Google Drive" : "S3-compatible storage"}</b><div class="note">${esc(s.remote)}</div></span>
        <button class="btn danger" id="disconnect">Disconnect</button>
      </div>` : `
      <b>Off-server copy</b>
      <p class="muted bk-sub">Right now backups are only on this server. If the server is lost, so are they. Keep a copy somewhere else:</p>
      <div class="row">
        <button class="btn" id="gdrive">${icon("drive")} Google Drive</button>
        <button class="btn" id="s3">${icon("cloud")} S3-compatible</button>
      </div>
      <div id="remotebox"></div>`;

    const done = async () => { d = await api("/api/backups"); drawRemote(); drawLive(); };
    el.querySelector("#disconnect")?.addEventListener("click", async () => {
      if (!(await ask({ title: "Stop copying backups off-server?", text: "Copies already there are kept.", ok: "Disconnect" }))) return;
      await api("/api/backups/remote", { method: "DELETE" });
      toast("Disconnected");
      done();
    });
    el.querySelector("#s3")?.addEventListener("click", () => s3Form(el.querySelector("#remotebox"), done));
    el.querySelector("#gdrive")?.addEventListener("click", () => driveForm(el.querySelector("#remotebox"), done));
  }

  // --- buttons inside the refreshing parts (one listener, so refreshes don't need re-wiring) ---

  async function run(app) {
    try {
      await api(`/api/backups/run${app ? `?app=${encodeURIComponent(app)}` : ""}`, { method: "POST" });
      toast("Backup started");
      refresh();
    } catch (err) { toast(err.message, "error"); }
  }

  async function restoreBackup(id, app) {
    // The button only unlocks once the name is typed, so there's no "didn't match" case.
    if (!(await askTyped({ title: `Restore this backup of ${app}?`, word: app, ok: "Restore",
      text: "The app stops for a moment, and its current data is REPLACED with what's in the backup." }))) return;
    restoring.add(id); drawLive();
    try { await api(`/api/backups/${id}/restore`, { method: "POST" }); toast(`${app} restored`); }
    catch (err) { toast(err.message, "error"); }
    restoring.delete(id);
    refresh();
  }

  view.querySelector("#now").onclick = () => run();
  view.querySelector("#list").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.one) run(b.dataset.one);
    if (b.dataset.restore) restoreBackup(Number(b.dataset.restore), b.dataset.app);
  };

  drawLive(); drawSchedule(); drawRemote();
  timer = setTimeout(refresh, d.running ? 2000 : 30000);
  return () => clearTimeout(timer);
}

// --- small pieces of HTML ---------------------------------------------------------

// "2 h ago", with the exact date when you hover it.
const when = (sqlDate) => `<span title="${esc(new Date(sqlDate.replace(" ", "T") + "Z").toLocaleString())}">${timeAgo(sqlDate)}</span>`;

const groupByApp = (list) => list.reduce((o, b) => ((o[b.app] ??= []).push(b), o), {});

// The four boxes at the top: last backup, next backup, off-server copy, apps.
function summary(d) {
  const s = d.settings;
  const last = d.backups.find((b) => b.status !== "running");
  const apps = Object.keys(groupByApp(d.backups)).length;
  const next = s.enabled && s.nextRun ? new Date(s.nextRun) : null;
  const box = (title, big, small, cls = "") => `<div class="card stat ${cls}"><span>${title}</span><b>${big}</b><span>${small}</span></div>`;
  return [
    last ? box("Last backup", timeAgo(last.created_at), last.status === "done" ? `${esc(last.app)} · worked` : `${esc(last.app)} · failed`, last.status === "done" ? "" : "bk-bad")
         : box("Last backup", "Never", "No backups yet"),
    next ? box("Next backup", next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), next.toDateString() === new Date().toDateString() ? "today" : "tomorrow")
         : box("Next backup", "Off", "Schedule is turned off", "bk-warn"),
    s.remote ? box("Off-server copy", "On", s.remoteType === "gdrive" ? "Google Drive" : "S3 storage")
             : box("Off-server copy", "Off", "Only on this server", "bk-warn"),
    box("Apps backed up", apps, apps === 1 ? "app" : "apps"),
  ].join("");
}

// While a backup runs: what it's doing. After a run: the log, folded away.
function progress(d) {
  if (!d.log.length && !d.running) return "";
  const log = `<pre class="log">${esc(d.log.join("\n") || "Starting…")}</pre>`;
  return d.running
    ? `<div class="card pad bk-run"><div class="row"><span class="spinner sm"></span><b>Backing up…</b></div>${log}</div>`
    : `<details class="card bk-run"><summary class="pad">Log of the last run</summary>${log}</details>`;
}

// Every backup, grouped by app.
function list(d, restoring) {
  const byApp = groupByApp(d.backups);
  if (!Object.keys(byApp).length) return `
    <div class="card empty" style="margin-top:22px">${icon("save")}<h2>No backups yet</h2>
      <p class="muted">Apps with a database or storage are backed up every night.<br>Want one right now? Click <b>Back up now</b>.</p></div>`;

  return Object.entries(byApp).map(([app, rows]) => `
    <div class="row spread bk-apphead"><b>${esc(app)}</b>
      <button class="btn" data-one="${esc(app)}" ${d.running ? "disabled" : ""}>${icon("save")} Back up now</button></div>
    <div class="card list">${rows.map((b) => row(b, app, d.running, restoring.has(b.id))).join("")}</div>`).join("");
}

function row(b, app, running, isRestoring) {
  const status = b.status === "done" ? "live" : b.status === "running" ? "building" : "failed";
  const label = b.status === "done" ? "Saved" : b.status === "running" ? "Running" : "Failed";
  const where = b.status !== "done" ? "" : [
    b.local ? `<span class="pill" style="--c:var(--accent)">On server</span>` : "",
    b.remote_status === "uploaded" ? `<span class="pill ok">Off-server</span>` : "",
    b.remote_status === "failed" ? `<span class="pill bad">Copy failed</span>` : "",
  ].join("");
  return `
    <div class="bk-row">
      <span class="status ${status}">${label}</span>
      <span class="grow">${when(b.created_at)}<div class="note">${esc(b.note || "")}</div></span>
      <span class="bk-where">${where}</span>
      <span class="muted bk-size">${b.size ? bytes(b.size) : ""}</span>
      <span class="bk-actions">${b.status === "done" ? `
        ${b.local ? `<a class="btn" href="/api/backups/${b.id}/download" title="Download">${icon("download")}</a>` : ""}
        ${isRestoring
          ? `<button class="btn" disabled><span class="spinner sm"></span> Restoring…</button>`
          : `<button class="btn" data-restore="${b.id}" data-app="${esc(app)}" ${running ? "disabled" : ""}>${icon("history")} Restore</button>`}` : ""}</span>
    </div>`;
}

// --- connecting an off-server destination ------------------------------------------

function s3Form(box, done) {
  box.innerHTML = `
    <form class="form bk-form">
      <label>Endpoint<input name="endpoint" placeholder="https://s3.us-west-004.backblazeb2.com" required></label>
      <div class="row"><label style="flex:2">Bucket<input name="bucket" required></label><label style="flex:1">Region<input name="region" placeholder="auto"></label></div>
      <div class="row"><label style="flex:1">Access key<input name="accessKey" required autocomplete="off"></label>
        <label style="flex:1">Secret key<input name="secretKey" type="password" required autocomplete="new-password"></label></div>
      <p class="note">Works with Backblaze B2, Cloudflare R2, Wasabi, AWS S3 and others. Use a private bucket.</p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Test &amp; save</button></div>
    </form>`;
  const f = box.querySelector("form");
  box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Testing…";
    try {
      await api("/api/backups/remote/s3", { method: "PUT", body: Object.fromEntries(new FormData(f)) });
      toast("Connected");
      done();
    } catch (err) { toast(err.message, "error"); btn.disabled = false; btn.textContent = "Test & save"; }
  };
}

// Google Drive with the user's own Google credentials, then a code at google.com/device.
function driveForm(box, done) {
  box.innerHTML = `
    <details class="guide bk-form" open>
      <summary><b>One-time setup in Google (about 5 minutes)</b></summary>
      <ol class="steps" style="margin-top:10px;font-size:13.5px">
        <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank">Google Cloud Console</a> and create a project (any name, e.g. "Deploy Boat").</li>
        <li>Turn on the <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank">Google Drive API</a> for it.</li>
        <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank">Google Auth Platform</a>, click <b>Get started</b>, choose <b>External</b>, fill in the app name and your email.</li>
        <li>Under <b>Audience</b>, click <b>Publish app</b>. (Otherwise Google disconnects it after 7 days.)</li>
        <li>Under <b>Clients</b>, create a client of type <b>TVs and Limited Input devices</b>.</li>
        <li>Copy its <b>Client ID</b> and <b>Client secret</b> here.</li>
      </ol>
    </details>
    <form class="form" style="margin-top:12px">
      <label>Client ID<input name="clientId" placeholder="….apps.googleusercontent.com" required autocomplete="off"></label>
      <label>Client secret<input name="clientSecret" type="password" required autocomplete="new-password"></label>
      <p class="note">Deploy Boat only gets access to the files it creates, in a "Deploy Boat Backups" folder. Nothing else in your Drive.</p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Continue</button></div>
    </form>`;
  box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
  const f = box.querySelector("form");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector(".primary"); btn.disabled = true;
    try {
      const r = await api("/api/backups/remote/gdrive/start", { method: "POST", body: { clientId: f.clientId.value, clientSecret: f.clientSecret.value } });
      box.innerHTML = `
        <div class="card pad bk-form" style="text-align:center;background:var(--bg)">
          <p>Open <a href="${esc(r.url)}" target="_blank"><b>${esc(r.url.replace("https://", ""))}</b></a> and enter this code:</p>
          <div class="devcode">${esc(r.userCode)} <button class="btn" id="cc">${icon("copy")}</button></div>
          <p class="note"><span class="spinner sm"></span> Waiting for you to approve in Google…</p>
          <button class="btn" data-x style="margin-top:10px">Cancel</button>
        </div>`;
      box.querySelector("#cc").onclick = () => copy(r.userCode);
      box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
      // Ask every few seconds until you've entered the code. Stops if you leave or cancel.
      const poll = async () => {
        if (!box.isConnected || !box.querySelector("#cc")) return;
        try {
          const p = await api("/api/backups/remote/gdrive/poll", { method: "POST" });
          if (p.status === "connected") { toast("Google Drive connected"); done(); return; }
          setTimeout(poll, r.interval * 1000);
        } catch (err) { toast(err.message, "error"); box.innerHTML = ""; }
      };
      setTimeout(poll, r.interval * 1000);
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
  };
}
