// Backups: schedule, off-server destination (S3 or Google Drive), list with restore/download.
import { api, esc, icon, toast, timeAgo, bytes, copy } from "../app.js";

export async function backupsScreen(view) {
  let timer;
  async function draw() {
    const d = await api("/api/backups");
    const s = d.settings;
    const byApp = Object.groupBy ? Object.groupBy(d.backups, (b) => b.app) : group(d.backups);

    view.innerHTML = `
      <div class="row spread head">
        <h1>Backups</h1>
        <button class="btn primary" id="now" ${d.running ? "disabled" : ""}>${d.running ? `<span class="spinner" style="width:14px;height:14px"></span> Backing up…` : `${icon("save")} Back up now`}</button>
      </div>

      ${d.running || d.log.length ? `<pre class="log" style="margin-bottom:14px;max-height:200px">${esc(d.log.join("\n") || "Starting…")}</pre>` : ""}

      <div class="stats">
        <form class="card pad" id="sched" style="grid-column:span 2">
          <b>Schedule</b>
          <div class="row" style="margin-top:10px;align-items:flex-end">
            <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> Every night at</label>
            <input type="time" name="time" value="${esc(s.time)}" style="width:auto">
            <label class="row" style="gap:6px">keep last <input type="number" name="keep" min="1" max="60" value="${s.keep}" style="width:70px"></label>
            <button class="btn">Save</button>
          </div>
          <p class="note" style="margin-top:8px">Time zone: ${esc(s.timezone)}. Only apps with a database or storage are backed up.</p>
        </form>
        <div class="card pad" style="grid-column:span 2">
          <b>Off-server copy</b>
          ${s.remote
            ? `<p style="margin-top:8px">${icon(s.remoteType === "gdrive" ? "drive" : "cloud")} ${esc(s.remote)}</p>
               <button class="btn danger" id="disconnect" style="margin-top:10px">Disconnect</button>`
            : `<p class="muted" style="margin:6px 0 10px">Backups on this server are lost if the server is. Keep a copy somewhere else.</p>
               <div class="row"><button class="btn" id="gdrive">${icon("drive")} Google Drive</button><button class="btn" id="s3">${icon("cloud")} S3-compatible</button></div>`}
          <div id="remotebox"></div>
        </div>
      </div>

      ${Object.keys(byApp).length ? Object.entries(byApp).map(([app, list]) => `
        <div class="row spread" style="margin:22px 0 8px"><b>${esc(app)}</b>
          <button class="btn" data-one="${esc(app)}" ${d.running ? "disabled" : ""}>${icon("save")} Back up now</button></div>
        <div class="card list">${list.map((b) => `
          <div>
            <span class="status ${b.status === "done" ? "live" : b.status === "running" ? "building" : "failed"}">${esc(b.status)}</span>
            <span class="grow">${timeAgo(b.created_at)} <span class="note">${esc(b.note || "")}</span></span>
            ${b.size ? `<span class="muted">${bytes(b.size)}</span>` : ""}
            ${b.status === "done" ? `
              <span class="note" title="Where this backup is kept">${b.local ? "server" : ""}${b.local && b.remote_status === "uploaded" ? " + " : ""}${b.remote_status === "uploaded" ? "off-server" : ""}</span>
              ${b.local ? `<a class="btn" href="/api/backups/${b.id}/download" title="Download">${icon("download")}</a>` : ""}
              <button class="btn" data-restore="${b.id}" data-app="${esc(app)}">${icon("history")} Restore</button>` : ""}
          </div>`).join("")}
        </div>`).join("")
      : `<div class="card empty">${icon("save")}<h2>No backups yet</h2><p class="muted">They'll appear here after the first nightly run, or click <b>Back up now</b>.</p></div>`}`;

    wire(d);
    timer = setTimeout(() => draw().catch(() => {}), d.running ? 2000 : 30000);
  }

  function wire(d) {
    view.querySelector("#now").onclick = () => run();
    view.querySelectorAll("[data-one]").forEach((b) => (b.onclick = () => run(b.dataset.one)));
    async function run(app) {
      try { await api(`/api/backups/run${app ? `?app=${encodeURIComponent(app)}` : ""}`, { method: "POST" }); toast("Backup started"); refresh(); }
      catch (err) { toast(err.message); }
    }

    const f = view.querySelector("#sched");
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/api/backups/settings", { method: "PUT", body: {
          enabled: f.enabled.checked, time: f.time.value, keep: Number(f.keep.value),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        } });
        toast("Saved"); refresh();
      } catch (err) { toast(err.message); }
    };

    view.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = async () => {
      const app = b.dataset.app;
      const typed = prompt(`Restore this backup of ${app}?\n\nThe app stops for a moment, and its current database and stored files are REPLACED with the backup.\n\nType the app name (${app}) to confirm:`);
      if (typed !== app) { if (typed !== null) toast("Name didn't match. Nothing changed."); return; }
      b.disabled = true; b.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span> Restoring…`;
      try { await api(`/api/backups/${b.dataset.restore}/restore`, { method: "POST" }); toast("Restored"); }
      catch (err) { toast(err.message); }
      refresh();
    }));

    view.querySelector("#disconnect")?.addEventListener("click", async () => {
      if (!confirm("Stop copying backups off-server? Copies already there are kept.")) return;
      await api("/api/backups/remote", { method: "DELETE" }); toast("Disconnected"); refresh();
    });
    view.querySelector("#s3")?.addEventListener("click", () => s3Form(view.querySelector("#remotebox"), refresh));
    view.querySelector("#gdrive")?.addEventListener("click", () => driveForm(view.querySelector("#remotebox"), refresh));
  }

  const refresh = () => { clearTimeout(timer); draw(); };
  await draw();
  return () => clearTimeout(timer);
}

const group = (list) => list.reduce((o, b) => ((o[b.app] ??= []).push(b), o), {});

function s3Form(box, done) {
  box.innerHTML = `
    <form class="form" style="margin-top:14px">
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
      toast("Connected"); done();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Test & save"; }
  };
}

// Google Drive with the user's own Google credentials, then a code at google.com/device.
function driveForm(box, done) {
  box.innerHTML = `
    <details class="guide" open style="margin-top:14px">
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
    try {
      const r = await api("/api/backups/remote/gdrive/start", { method: "POST", body: { clientId: f.clientId.value, clientSecret: f.clientSecret.value } });
      box.innerHTML = `
        <div class="card pad" style="margin-top:14px;text-align:center;background:var(--bg)">
          <p>Open <a href="${esc(r.url)}" target="_blank"><b>${esc(r.url.replace("https://", ""))}</b></a> and enter this code:</p>
          <div class="devcode">${esc(r.userCode)} <button class="btn" id="cc">${icon("copy")}</button></div>
          <p class="note"><span class="spinner" style="display:inline-block;width:12px;height:12px;vertical-align:-2px"></span> Waiting for you to approve in Google…</p>
        </div>`;
      box.querySelector("#cc").onclick = () => copy(r.userCode);
      const poll = async () => {
        if (!box.isConnected) return;
        try {
          const p = await api("/api/backups/remote/gdrive/poll", { method: "POST" });
          if (p.status === "connected") { toast("Google Drive connected"); done(); return; }
          setTimeout(poll, r.interval * 1000);
        } catch (err) { toast(err.message); box.innerHTML = ""; }
      };
      setTimeout(poll, r.interval * 1000);
    } catch (err) { toast(err.message); }
  };
}
