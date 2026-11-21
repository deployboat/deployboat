// App → Crons: jobs that visit a URL in the app or run a command in it, on a schedule.
//
// A table of jobs (what, when, last runs, next run, actions). Click a row for its history.
// "New job" opens a form: what to run, when, and a time limit. The schedule is shown in
// words as you pick it. The server side is crons/index.ts and api/crons.ts.
import { api, esc, icon, toast, timeAgo } from "../app.js";
import { ask } from "../dialog.js";
import { openMenu } from "../menu.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The quick choices in the form. "daily" and "weekly" also ask for a time (and a day).
const EVERY = [
  ["*/5 * * * *", "5 min"],
  ["*/15 * * * *", "15 min"],
  ["0 * * * *", "Hour"],
  ["daily", "Day"],
  ["weekly", "Week"],
  ["custom", "Custom"],
];

// Ideas for the first job. They fill in the form.
const EXAMPLES = [
  { name: "Clean up old sessions", kind: "url", target: "/api/cleanup", schedule: "0 * * * *" },
  { name: "Send the daily digest", kind: "url", target: "/api/digest", schedule: "0 9 * * *" },
  { name: "Weekly report", kind: "command", target: "npm run report", schedule: "0 8 * * 1" },
];

const two = (n) => String(n).padStart(2, "0");

// A cron expression in words, when it's one we know. Otherwise the expression itself.
export function describe(expr) {
  const known = { "*/5 * * * *": "Every 5 minutes", "*/15 * * * *": "Every 15 minutes", "*/30 * * * *": "Every 30 minutes", "0 * * * *": "Every hour" };
  if (known[expr]) return known[expr];
  let m = expr.match(/^(\d+) (\d+) \* \* \*$/);
  if (m) return `Every day at ${two(m[2])}:${two(m[1])}`;
  m = expr.match(/^(\d+) (\d+) \* \* (\d)$/);
  if (m) return `Every ${DAYS[m[3]]} at ${two(m[2])}:${two(m[1])}`;
  m = expr.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (m) return `Weekdays at ${two(m[2])}:${two(m[1])}`;
  return expr;
}

// "in 4 min", "today 09:00", "Mon 09:00"
function soon(iso) {
  if (!iso) return "—";
  const d = new Date(iso), mins = Math.round((d - Date.now()) / 60000);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return `in ${mins} min`;
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `today ${time}` : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

const seconds = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pill = (status) => ({ ok: "ok", failed: "bad", running: "info", skipped: "plain" })[status] ?? "plain";

export async function crons(box, base, app) {
  let jobs = [];
  const openHistory = new Set(); // job ids whose history is shown

  box.innerHTML = `
    <div class="cronintro">
      <p class="muted">Run something on a schedule: visit a URL in your app, or run a command in it. Failed runs are retried twice.</p>
      <button class="btn primary" id="add">${icon("plus")} New job</button>
    </div>
    <div id="formbox"></div>
    <div id="list"></div>`;
  box.querySelector("#add").onclick = () => form(box, base, app, null, refresh);

  async function refresh() {
    try { jobs = await api(`${base}/crons`); } catch { return; }
    if (box.isConnected) draw();
  }

  function draw() {
    const el = box.querySelector("#list");
    if (!jobs.length) {
      el.innerHTML = `
        <div class="card cronempty">
          ${icon("clock")}
          <h3>No jobs yet</h3>
          <p class="muted">Start from an example, or make your own with New job.</p>
          <div class="cronexamples">${EXAMPLES.map((x, i) => `
            <button class="card" data-example="${i}">${icon(x.kind === "url" ? "globe" : "term")}
              <span><b>${esc(x.name)}</b><span class="note">${esc(describe(x.schedule))} · <code>${esc(x.target)}</code></span></span></button>`).join("")}</div>
        </div>`;
      el.querySelectorAll("[data-example]").forEach((b) => (b.onclick = () => form(box, base, app, { ...EXAMPLES[b.dataset.example], id: null }, refresh)));
      return;
    }
    el.innerHTML = `
      <div class="card crontable">
        <div class="cronhead"><span>Job</span><span>Schedule</span><span>Last runs</span><span>Next run</span><span></span></div>
        ${jobs.map(row).join("")}
      </div>`;
    el.querySelectorAll("[data-job]").forEach((r) => (r.onclick = (e) => {
      if (e.target.closest("button, a")) return;
      const id = Number(r.dataset.job);
      openHistory.has(id) ? openHistory.delete(id) : openHistory.add(id);
      draw();
    }));
    el.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => runNow(b)));
    el.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => rowMenu(b, jobs.find((j) => j.id === Number(b.dataset.more)))));
    el.querySelectorAll("[data-history]").forEach((h) => loadRuns(h, base));
  }

  function row(j) {
    const state = j.running ? "running" : !j.enabled ? "paused" : j.lastRun?.status === "failed" ? "failed" : j.lastRun ? "ok" : "new";
    const open = openHistory.has(j.id);
    return `
      <div class="cronrow ${j.enabled ? "" : "paused"} ${open ? "open" : ""}" data-job="${j.id}">
        <div class="croncell cronjob">
          <span class="cronicon ${state}">${state === "running" ? `<span class="spinner sm"></span>` : icon(j.kind === "url" ? "globe" : "term")}</span>
          <span class="grow"><b>${esc(j.name)}</b>${!j.enabled ? ` <span class="tag">Paused</span>` : ""}
            <code class="crontarget">${esc(j.target)}</code></span>
        </div>
        <div class="croncell"><span>${esc(describe(j.schedule))}</span><span class="note">${esc(j.timezone)}</span></div>
        <div class="croncell">
          <span class="cronstrip">${j.recent.map((r) => `<i class="${pill(r.status)}" title="${esc(r.status)} · ${timeAgo(r.started_at)}${r.duration_ms != null ? ` · ${seconds(r.duration_ms)}` : ""}"></i>`).join("")
            || `<span class="note">Not run yet</span>`}</span>
          ${j.lastRun ? `<span class="note">${esc(j.lastRun.status)} · ${timeAgo(j.lastRun.started_at)}</span>` : ""}
        </div>
        <div class="croncell">${j.running ? `<span class="pill info">Running</span>` : j.enabled ? `<span>${soon(j.nextRun)}</span>` : `<span class="note">Paused</span>`}</div>
        <div class="croncell cronacts">
          <button class="btn" data-run="${j.id}" ${j.running ? "disabled" : ""} title="Run it now">${icon("play")} Run</button>
          <button class="btn ghost" data-more="${j.id}" title="More">${icon("dots")}</button>
        </div>
      </div>
      ${open ? `<div class="cronhistory" data-history="${j.id}"><div class="fb-loading"><span class="spinner"></span></div></div>` : ""}`;
  }

  async function runNow(b) {
    b.disabled = true;
    try { await api(`${base}/crons/${b.dataset.run}/run`, { method: "POST" }); toast("Started"); openHistory.add(Number(b.dataset.run)); }
    catch (err) { toast(err.message, "error"); }
    setTimeout(refresh, 800);
  }

  function rowMenu(btn, job) {
    openMenu(btn, (menu, close) => {
      menu.innerHTML = `
        <button data-a="edit">${icon("edit")}<span class="grow">Edit</span></button>
        <button data-a="toggle">${icon(job.enabled ? "pause" : "play")}<span class="grow">${job.enabled ? "Pause" : "Resume"}</span></button>
        <button data-a="history">${icon("history")}<span class="grow">${openHistory.has(job.id) ? "Hide history" : "Show history"}</span></button>
        <button data-a="copy">${icon("copy")}<span class="grow">Duplicate</span></button>
        <hr>
        <button data-a="delete" class="danger">${icon("trash")}<span class="grow">Delete</span></button>`;
      menu.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
        close();
        const a = b.dataset.a;
        if (a === "edit") return form(box, base, app, job, refresh);
        if (a === "copy") return form(box, base, app, { ...job, id: null, name: `${job.name} (copy)` }, refresh);
        if (a === "history") { openHistory.has(job.id) ? openHistory.delete(job.id) : openHistory.add(job.id); return draw(); }
        if (a === "toggle") {
          await api(`${base}/crons/${job.id}/toggle`, { method: "POST" }).catch((err) => toast(err.message, "error"));
          toast(job.enabled ? "Paused" : "Resumed");
        }
        if (a === "delete") {
          if (!(await ask({ title: `Delete "${job.name}"?`, text: "Its run history goes too.", ok: "Delete job", danger: true }))) return;
          await api(`${base}/crons/${job.id}`, { method: "DELETE" }).catch((err) => toast(err.message, "error"));
          toast("Deleted");
        }
        refresh();
      }));
    }, { align: "right" });
  }

  await refresh();
  // Keep statuses fresh. The form lives in its own box, so typing isn't interrupted.
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  return () => clearInterval(timer);
}

// The last runs of one job, each with its output.
async function loadRuns(el, base) {
  if (el.dataset.loaded) return;
  el.dataset.loaded = "1";
  const runs = await api(`${base}/crons/${el.dataset.history}/runs`).catch(() => []);
  el.innerHTML = runs.length ? `<div class="cronruns">${runs.map((r) => `
    <details>
      <summary>
        <span class="pill ${pill(r.status)}">${esc(r.status)}</span>
        <span class="grow">${timeAgo(r.started_at)}${r.attempts > 1 ? ` <span class="note">· ${r.attempts} tries</span>` : ""}</span>
        <span class="note">${seconds(r.duration_ms)}</span>
        <span class="chev">${icon("chevron")}</span>
      </summary>
      <pre class="log">${esc(r.output || "(no output)")}</pre>
    </details>`).join("")}</div>` : `<p class="note" style="padding:12px 18px">No runs yet. Use Run to try it now.</p>`;
}

// --- the New job / Edit form ------------------------------------------------------------

// `job` is null for a new job, a saved job to edit, or a filled-in draft (id: null).
function form(box, base, app, job, done) {
  const editing = job?.id != null;
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];
  const tz = job?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  // Read the saved schedule back into the form's choices.
  let every = "0 * * * *", time = "09:00", day = "1", custom = "", m;
  const s = job?.schedule;
  if (s && EVERY.some(([e]) => e === s)) every = s;
  else if (s && (m = s.match(/^(\d+) (\d+) \* \* \*$/))) { every = "daily"; time = `${two(m[2])}:${two(m[1])}`; }
  else if (s && (m = s.match(/^(\d+) (\d+) \* \* (\d)$/))) { every = "weekly"; time = `${two(m[2])}:${two(m[1])}`; day = m[3]; }
  else if (s) { every = "custom"; custom = s; }

  const fb = box.querySelector("#formbox");
  fb.innerHTML = `
    <form class="card cronform" id="jobform">
      <div class="cronform-head"><b>${editing ? `Edit "${esc(job.name)}"` : "New job"}</b>
        <button type="button" class="btn ghost" data-x title="Close">${icon("x")}</button></div>

      <div class="cronstep"><span class="stepnum">1</span><div class="grow">
        <b>What should it do?</b>
        <div class="seg">
          <label><input type="radio" name="kind" value="url" ${job?.kind !== "command" ? "checked" : ""}>${icon("globe")} Visit a URL</label>
          <label><input type="radio" name="kind" value="command" ${job?.kind === "command" ? "checked" : ""}>${icon("term")} Run a command</label>
        </div>
        <div class="prefixed"><span id="prefix"></span><input name="target" value="${esc(job?.target ?? "")}" required autocomplete="off" spellcheck="false"></div>
        <p class="note" id="kindnote"></p>
        <label>Name<input name="name" value="${esc(job?.name ?? "")}" placeholder="Clean up old sessions" required maxlength="60"></label>
      </div></div>

      <div class="cronstep"><span class="stepnum">2</span><div class="grow">
        <b>When?</b>
        <div class="chips" id="every">${EVERY.map(([v, l]) => `<button type="button" data-every="${v}" class="${v === every ? "on" : ""}">${v === "custom" ? l : `Every ${l.toLowerCase()}`}</button>`).join("")}</div>
        <div class="row cronwhen">
          <label id="daybox">Day<select name="day">${DAYS.map((d, i) => `<option value="${i}" ${String(i) === day ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label id="timebox">Time<input name="time" type="time" value="${time}"></label>
          <label id="custombox" class="grow">Cron expression<input name="custom" value="${esc(custom)}" placeholder="0 3 * * 1-5" spellcheck="false"></label>
          <label class="grow">Time zone<select name="tz">${(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => `<option ${z === tz ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></label>
        </div>
        <p class="cronsummary" id="summary"></p>
      </div></div>

      <div class="cronstep"><span class="stepnum">3</span><div class="grow">
        <b>Time limit</b>
        <div class="row" style="gap:10px;align-items:center">
          <select name="timeout" style="width:auto">${[1, 5, 10, 30, 60].map((n) => `<option value="${n * 60}" ${(job?.timeout ?? 600) === n * 60 ? "selected" : ""}>${n} min</option>`).join("")}</select>
          <span class="note">A run that takes longer is stopped and counts as failed. Failed runs are tried twice more.</span>
        </div>
      </div></div>

      <div class="cronform-foot">
        <button type="button" class="btn" data-x>Cancel</button>
        <button class="btn primary">${editing ? "Save changes" : `${icon("plus")} Create job`}</button>
      </div>
    </form>`;

  const f = fb.querySelector("form");
  const host = (app?.url ?? "").replace(/^https:\/\//, "");
  let chosen = every;

  // The schedule from the current choices, as a cron expression.
  const expression = () => {
    const [h, mi] = f.time.value.split(":").map(Number);
    return chosen === "daily" ? `${mi} ${h} * * *` : chosen === "weekly" ? `${mi} ${h} * * ${f.day.value}` : chosen === "custom" ? f.custom.value.trim() : chosen;
  };

  const sync = () => {
    const url = f.kind.value === "url";
    f.querySelectorAll(".seg label").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
    f.querySelector("#prefix").textContent = url ? host : "$";
    f.target.placeholder = url ? "/api/cleanup" : "npm run report";
    f.querySelector("#kindnote").textContent = url
      ? "We call this path in your app (a GET request from inside the server). Answer with a 2xx status for success."
      : "Runs inside your app's container, in its folder, with its variables. Exit code 0 means success.";
    f.querySelectorAll("[data-every]").forEach((b) => b.classList.toggle("on", b.dataset.every === chosen));
    f.querySelector("#daybox").hidden = chosen !== "weekly";
    f.querySelector("#timebox").hidden = chosen !== "daily" && chosen !== "weekly";
    f.querySelector("#custombox").hidden = chosen !== "custom";
    const expr = expression();
    f.querySelector("#summary").innerHTML = expr
      ? `${icon("clock")} <b>${esc(describe(expr))}</b> <span class="note">· ${esc(f.tz.value)}${describe(expr) !== expr ? ` · <code>${esc(expr)}</code>` : ""}</span>`
      : `${icon("clock")} <span class="note">Type a cron expression: minute hour day month weekday, like <code>0 3 * * 1-5</code>.</span>`;
  };
  f.querySelectorAll("input[name=kind]").forEach((r) => (r.onchange = sync));
  f.querySelectorAll("[data-every]").forEach((b) => (b.onclick = () => { chosen = b.dataset.every; sync(); }));
  for (const n of ["day", "time", "custom", "tz"]) f[n].addEventListener("input", sync);
  sync();
  f.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => (fb.innerHTML = "")));
  f.scrollIntoView({ behavior: "smooth", block: "nearest" });
  (job?.target ? f.name : f.target).focus();

  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { name: f.name.value, kind: f.kind.value, target: f.target.value, schedule: expression(), timezone: f.tz.value, timeout: Number(f.timeout.value) };
    const btn = f.querySelector(".primary"); btn.disabled = true;
    try {
      await api(editing ? `${base}/crons/${job.id}` : `${base}/crons`, { method: editing ? "PUT" : "POST", body });
      toast(editing ? "Saved" : "Job created");
      fb.innerHTML = ""; done();
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
  };
}
