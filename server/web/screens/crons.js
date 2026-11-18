// Crons page: scheduled jobs that visit a URL or run a command in the app.
import { api, esc, icon, toast, timeAgo } from "../app.js";

const PRESETS = [
  ["*/5 * * * *", "Every 5 minutes"],
  ["*/15 * * * *", "Every 15 minutes"],
  ["0 * * * *", "Every hour"],
  ["daily", "Every day at…"],
  ["weekly", "Every week on…"],
  ["custom", "Custom (cron expression)"],
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Turn a cron expression into words when we can.
function describe(expr) {
  const p = PRESETS.find(([e]) => e === expr);
  if (p) return p[1];
  let m = expr.match(/^(\d+) (\d+) \* \* \*$/);
  if (m) return `Every day at ${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  m = expr.match(/^(\d+) (\d+) \* \* (\d)$/);
  if (m) return `Every ${DAYS[m[3]]} at ${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  return expr;
}

const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso), mins = Math.round((d - Date.now()) / 60000);
  if (mins < 1) return "in less than a minute";
  if (mins < 60) return `in ${mins} min`;
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
};

export async function crons(box, base) {
  async function draw() {
    const jobs = await api(`${base}/crons`);
    const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.id));
    box.innerHTML = `
      <div class="row spread" style="margin-bottom:12px">
        <span class="muted">Run something on a schedule. Failed runs are retried twice.</span>
        <button class="btn primary" id="add">${icon("plus")} New job</button>
      </div>
      <div id="formbox"></div>
      <div class="card">${jobs.map((j) => `
        <details class="ver" data-id="${j.id}" ${open.has(String(j.id)) ? "open" : ""}>
          <summary>
            <span class="chev">${icon("chevron")}</span>
            <span class="status ${j.running ? "building" : !j.enabled ? "stopped" : j.lastRun?.status === "failed" ? "failed" : "live"}">
              ${j.running ? "running" : !j.enabled ? "paused" : j.lastRun?.status ?? "waiting"}</span>
            <span class="grow"><b>${esc(j.name)}</b> <span class="muted">· ${esc(describe(j.schedule))}</span></span>
            <span class="muted" style="font-size:13px">${j.enabled ? `Next ${when(j.nextRun)}` : ""}</span>
          </summary>
          <div class="verbody">
            <dl class="info">
              <dt>${j.kind === "url" ? "Visits" : "Runs"}</dt><dd><code>${esc(j.target)}</code></dd>
              <dt>Schedule</dt><dd>${esc(describe(j.schedule))} <span class="muted">(${esc(j.schedule)}, ${esc(j.timezone)})</span></dd>
              <dt>Time limit</dt><dd>${Math.round(j.timeout / 60)} min</dd>
            </dl>
            <div class="row">
              <button class="btn" data-run="${j.id}" ${j.running ? "disabled" : ""}>${icon("play")} Run now</button>
              <button class="btn" data-toggle="${j.id}">${j.enabled ? `${icon("stop")} Pause` : `${icon("play")} Resume`}</button>
              <button class="btn" data-edit="${j.id}">Edit</button>
              <button class="btn danger" data-del="${j.id}">${icon("trash")}</button>
            </div>
            <div class="runs" data-runs="${j.id}"><span class="note">Loading history…</span></div>
          </div>
        </details>`).join("") || `<div class="pad muted">No jobs yet. Example: visit <code>/api/cleanup</code> every hour.</div>`}
      </div>`;

    box.querySelector("#add").onclick = () => form(box, base, null, draw);
    box.querySelectorAll("details.ver").forEach((el) => {
      if (el.open) loadRuns(el, base);
      el.addEventListener("toggle", () => el.open && loadRuns(el, base));
    });
    const act = (sel, fn) => box.querySelectorAll(`[${sel}]`).forEach((b) => (b.onclick = () => fn(b.getAttribute(sel), b)));
    act("data-run", async (id, b) => {
      b.disabled = true;
      try { await api(`${base}/crons/${id}/run`, { method: "POST" }); toast("Started"); setTimeout(draw, 1500); }
      catch (err) { toast(err.message); b.disabled = false; }
    });
    act("data-toggle", async (id) => { await api(`${base}/crons/${id}/toggle`, { method: "POST" }); draw(); });
    act("data-edit", (id) => form(box, base, jobs.find((j) => String(j.id) === id), draw));
    act("data-del", async (id) => {
      if (!confirm("Delete this job and its history?")) return;
      await api(`${base}/crons/${id}`, { method: "DELETE" }); toast("Deleted"); draw();
    });
  }

  await draw();
  // Keep statuses fresh, but don't redraw while the form is open.
  const timer = setInterval(() => { if (!box.querySelector("#jobform")) draw().catch(() => {}); }, 5000);
  return () => clearInterval(timer);
}

async function loadRuns(el, base) {
  const target = el.querySelector("[data-runs]");
  const runs = await api(`${base}/crons/${el.dataset.id}/runs`);
  target.innerHTML = runs.length ? `
    <span class="note">Last runs</span>
    <div class="card list" style="margin-top:6px">${runs.map((r) => `
      <details class="ver">
        <summary>
          <span class="status ${r.status === "ok" ? "live" : r.status === "running" ? "building" : r.status === "skipped" ? "stopped" : "failed"}">${esc(r.status)}</span>
          <span class="grow muted">${timeAgo(r.started_at)}${r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}</span>
          <span class="muted">${r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : ""}</span>
        </summary>
        <pre class="log" style="margin:0 18px 14px">${esc(r.output || "(no output)")}</pre>
      </details>`).join("")}
    </div>` : `<span class="note">No runs yet.</span>`;
}

// Add or edit a job.
function form(box, base, job, done) {
  const tz = job?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  let preset = "0 * * * *", time = "09:00", day = "1", custom = "";
  if (job) {
    let d;
    if (PRESETS.some(([e]) => e === job.schedule)) preset = job.schedule;
    else if ((d = job.schedule.match(/^(\d+) (\d+) \* \* \*$/))) { preset = "daily"; time = `${d[2].padStart(2, "0")}:${d[1].padStart(2, "0")}`; }
    else if ((d = job.schedule.match(/^(\d+) (\d+) \* \* (\d)$/))) { preset = "weekly"; time = `${d[2].padStart(2, "0")}:${d[1].padStart(2, "0")}`; day = d[3]; }
    else { preset = "custom"; custom = job.schedule; }
  }

  const fb = box.querySelector("#formbox");
  fb.innerHTML = `
    <form class="card pad form" id="jobform" style="margin-bottom:14px">
      <div class="row spread"><b>${job ? "Edit job" : "New job"}</b><button type="button" class="btn" id="cancel">Cancel</button></div>
      <label>Name<input name="name" value="${esc(job?.name ?? "")}" placeholder="Clean up old sessions" required></label>
      <div class="choices" style="grid-template-columns:1fr 1fr">
        <label class="choice"><input type="radio" name="kind" value="url" hidden ${job?.kind !== "command" ? "checked" : ""}>
          ${icon("globe")}<b>Visit a URL</b><span>Calls a path in your app</span></label>
        <label class="choice"><input type="radio" name="kind" value="command" hidden ${job?.kind === "command" ? "checked" : ""}>
          ${icon("term")}<b>Run a command</b><span>Runs inside your app</span></label>
      </div>
      <label id="tlabel">Path<input name="target" value="${esc(job?.target ?? "")}" required autocomplete="off"></label>
      <div class="row" style="align-items:flex-end">
        <label style="flex:2;min-width:180px">When<select name="preset">${PRESETS.map(([v, l]) => `<option value="${v}" ${v === preset ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label style="flex:1;min-width:120px" id="daybox">Day<select name="day">${DAYS.map((d, i) => `<option value="${i}" ${String(i) === day ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        <label style="flex:1;min-width:110px" id="timebox">Time<input name="time" type="time" value="${time}"></label>
        <label style="flex:2;min-width:180px" id="custombox">Cron expression<input name="custom" value="${esc(custom)}" placeholder="0 3 * * 1-5"></label>
      </div>
      <div class="row spread">
        <span class="note">Time zone: ${esc(tz)}</span>
        <label class="row" style="gap:8px;font-weight:500">Time limit
          <select name="timeout" style="width:auto">${[1, 5, 10, 30, 60].map((m) => `<option value="${m * 60}" ${(job?.timeout ?? 600) === m * 60 ? "selected" : ""}>${m} min</option>`).join("")}</select></label>
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary">${job ? "Save" : "Create job"}</button></div>
    </form>`;

  const f = fb.querySelector("form");
  const sync = () => {
    const kind = f.kind.value;
    f.querySelectorAll(".choice").forEach((c) => c.classList.toggle("on", c.querySelector("input").checked));
    f.querySelector("#tlabel").firstChild.textContent = kind === "url" ? "Path" : "Command";
    f.target.placeholder = kind === "url" ? "/api/cleanup" : "npm run send-emails";
    const p = f.preset.value;
    f.querySelector("#daybox").hidden = p !== "weekly";
    f.querySelector("#timebox").hidden = p !== "daily" && p !== "weekly";
    f.querySelector("#custombox").hidden = p !== "custom";
  };
  f.querySelectorAll("input[name=kind]").forEach((r) => (r.onchange = sync));
  f.preset.onchange = sync;
  sync();
  f.querySelector("#cancel").onclick = () => (fb.innerHTML = "");
  f.name.focus();

  f.onsubmit = async (e) => {
    e.preventDefault();
    const [h, m] = f.time.value.split(":").map(Number);
    const p = f.preset.value;
    const schedule = p === "daily" ? `${m} ${h} * * *` : p === "weekly" ? `${m} ${h} * * ${f.day.value}` : p === "custom" ? f.custom.value.trim() : p;
    const body = { name: f.name.value, kind: f.kind.value, target: f.target.value, schedule, timezone: tz, timeout: Number(f.timeout.value) };
    try {
      await api(job ? `${base}/crons/${job.id}` : `${base}/crons`, { method: job ? "PUT" : "POST", body });
      toast(job ? "Saved" : "Job created");
      fb.innerHTML = ""; done();
    } catch (err) { toast(err.message); }
  };
}
