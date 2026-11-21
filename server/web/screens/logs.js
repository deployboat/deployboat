// App → Logs, with tabs:
//   Runtime   everything the app prints (stdout and stderr), live
//   Errors    only errors and warnings
//   Debug     only debug and trace lines
//   Deploys   the build log of each version
//   Cron jobs the output of recent cron runs
//
// The first three share the same lines (from /logs/lines); the server guesses each
// line's level (see lib/logs.ts). The tab is kept in the address (?tab=errors).
import { api, esc, icon, copy, timeAgo } from "../app.js";
import { openMenu } from "../menu.js";

const TABS = [
  ["runtime", "Runtime", "term"],
  ["errors", "Errors", "alert"],
  ["debug", "Debug", "sparkle"],
  ["deploys", "Deploys", "rocket"],
  ["crons", "Cron jobs", "clock"],
];

// The color of each level's dot (same as in the log, see style.css).
const DOT = { error: "var(--bad)", warn: "var(--warn)", info: "var(--muted)", debug: "#8b5cf6" };

// Which levels each runtime tab shows.
const SHOWS = { runtime: ["error", "warn", "info", "debug"], errors: ["error", "warn"], debug: ["debug"] };

export async function logsPage(box, base, app) {
  let tab = new URLSearchParams(location.hash.split("?")[1] ?? "").get("tab") ?? "runtime";
  let stopTab = () => {};

  box.innerHTML = `
    <nav class="tabs logtabs">${TABS.map(([id, label, ic]) =>
      `<a data-tab="${id}">${icon(ic)}${label}<span class="tabcount" data-count="${id}" hidden></span></a>`).join("")}</nav>
    <div id="tabbox"></div>`;

  async function show(id) {
    stopTab();
    tab = id;
    history.replaceState(null, "", `#/apps/${encodeURIComponent(app.name)}/logs?tab=${id}`);
    box.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === id));
    const el = box.querySelector("#tabbox");
    if (id === "deploys") stopTab = deploysTab(el, base, app) ?? (() => {});
    else if (id === "crons") stopTab = (await cronsTab(el, base)) ?? (() => {});
    else stopTab = runtimeTab(el, base, id, (counts) => setCounts(counts));
  }
  box.querySelectorAll("[data-tab]").forEach((a) => (a.onclick = () => show(a.dataset.tab)));

  // Error and debug counts on the tabs, from the runtime lines we've loaded.
  function setCounts({ errors, debug }) {
    for (const [id, n] of [["errors", errors], ["debug", debug]]) {
      const el = box.querySelector(`[data-count="${id}"]`);
      el.hidden = !n; el.textContent = n > 999 ? "999+" : n;
      el.classList.toggle("bad", id === "errors");
    }
  }

  await show(TABS.some(([id]) => id === tab) ? tab : "runtime");
  return () => stopTab();
}

// --- Runtime / Errors / Debug ------------------------------------------------

function runtimeTab(el, base, tab, onCounts) {
  // Saved per browser: how many lines, wrap, show times.
  const pref = (k, d) => { try { return JSON.parse(localStorage.getItem(`logs.${k}`)) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(`logs.${k}`, JSON.stringify(v)); } catch { /* private mode */ } };
  let lines = [], live = true, timer = null, stopped = false;
  let count = pref("lines", 1000), wrap = pref("wrap", true), times = pref("times", true);
  let levels = new Set(SHOWS[tab]); // the level chips can narrow it down further

  el.innerHTML = `
    <div class="logbar">
      <div class="fb-filter logsearch">${icon("search")}<input id="q" placeholder="Search logs" autocomplete="off"></div>
      ${tab === "runtime" || tab === "errors" ? `<div class="chips" id="levels">${SHOWS[tab].map((l) =>
        `<button data-level="${l}" class="on"><span class="lvdot" style="--c:${DOT[l]}"></span>${l}</button>`).join("")}</div>` : ""}
      <span class="grow"></span>
      <select id="count" title="How many lines to load">${[200, 1000, 5000].map((n) =>
        `<option value="${n}" ${n === count ? "selected" : ""}>Last ${n.toLocaleString()} lines</option>`).join("")}</select>
      <button class="btn" id="live" title="Pause or resume live updates"></button>
      <button class="btn ghost" id="more" title="More">${icon("dots")}</button>
    </div>
    <div class="logview-wrap">
      <div class="logview ${wrap ? "wrap" : ""} ${times ? "" : "notime"}" id="view"><div class="logempty">Loading…</div></div>
      <button class="btn jump" id="jump" hidden>${icon("down")} Jump to latest</button>
    </div>
    <div class="logfoot note" id="foot"></div>`;

  const view = el.querySelector("#view"), q = el.querySelector("#q");
  const atBottom = () => view.scrollHeight - view.scrollTop - view.clientHeight < 40;

  function draw(keepPlace) {
    const follow = !keepPlace || atBottom();
    const needle = q.value.trim().toLowerCase();
    const shown = lines.filter((l) => levels.has(l.level) && (!needle || l.text.toLowerCase().includes(needle)));
    view.innerHTML = shown.map((l) => `
      <div class="ll ${l.level} ${l.stream}"><time title="${esc(new Date(l.time).toLocaleString())}">${clock(l.time)}</time><b>${l.level}</b><span>${mark(l.text, needle)}</span></div>`).join("")
      || `<div class="logempty">${emptyText(tab, lines.length, needle)}</div>`;
    if (follow) view.scrollTop = view.scrollHeight;
    el.querySelector("#jump").hidden = atBottom();
    el.querySelector("#foot").textContent = `${shown.length.toLocaleString()} of ${lines.length.toLocaleString()} lines`
      + (live ? " · live" : " · paused");
    onCounts({ errors: lines.filter((l) => l.level === "error").length, debug: lines.filter((l) => l.level === "debug").length });
  }

  async function load() {
    try { lines = await api(`${base}/logs/lines?lines=${count}`); }
    catch (err) { view.innerHTML = `<div class="logempty">${esc(err.message)}</div>`; return; }
    if (!stopped) draw(false);
  }

  // New lines since the last one we have. The newest time can repeat, so skip lines we already show.
  async function poll() {
    if (!live || stopped || document.hidden) return;
    const last = lines.at(-1)?.time;
    try {
      const fresh = await api(`${base}/logs/lines?lines=${count}${last ? `&since=${encodeURIComponent(last)}` : ""}`);
      const seen = new Set(lines.filter((l) => l.time === last).map((l) => l.text));
      const add = fresh.filter((l) => !(l.time === last && seen.has(l.text)) && (!last || l.time >= last));
      if (!add.length || stopped) return;
      lines = lines.concat(add).slice(-count);
      draw(true);
    } catch { /* try again next time */ }
  }

  const drawLive = () => {
    const b = el.querySelector("#live");
    b.innerHTML = live ? `<span class="livedot"></span> Live` : `${icon("play")} Resume`;
    b.classList.toggle("on", live);
  };
  el.querySelector("#live").onclick = () => { live = !live; drawLive(); draw(true); if (live) poll(); };
  drawLive();

  q.oninput = () => draw(false);
  el.querySelector("#count").onchange = (e) => { count = Number(e.target.value); setPref("lines", count); load(); };
  el.querySelectorAll("[data-level]").forEach((b) => (b.onclick = () => {
    const l = b.dataset.level;
    // Clicking the only one left turns them all back on.
    if (levels.has(l) && levels.size === 1) levels = new Set(SHOWS[tab]);
    else levels.has(l) ? levels.delete(l) : levels.add(l);
    el.querySelectorAll("[data-level]").forEach((x) => x.classList.toggle("on", levels.has(x.dataset.level)));
    draw(false);
  }));
  view.onscroll = () => (el.querySelector("#jump").hidden = atBottom());
  el.querySelector("#jump").onclick = () => { view.scrollTop = view.scrollHeight; };

  // The "⋯" menu: wrap, times, copy, download.
  el.querySelector("#more").onclick = (e) => {
    openMenu(e.currentTarget, (menu, close) => {
      menu.innerHTML = `
        <button data-a="wrap">${icon("list")}<span class="grow">Wrap long lines</span><span class="dd-check">${wrap ? "✓" : ""}</span></button>
        <button data-a="times">${icon("clock")}<span class="grow">Show times</span><span class="dd-check">${times ? "✓" : ""}</span></button>
        <hr>
        <button data-a="copy">${icon("copy")}<span class="grow">Copy shown lines</span></button>
        <button data-a="download">${icon("download")}<span class="grow">Download shown lines</span></button>`;
      menu.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
        close();
        const a = b.dataset.a;
        if (a === "wrap") { wrap = !wrap; setPref("wrap", wrap); view.classList.toggle("wrap", wrap); }
        if (a === "times") { times = !times; setPref("times", times); view.classList.toggle("notime", !times); }
        const text = () => [...view.querySelectorAll(".ll")].map((r) =>
          `${r.querySelector("time").title}  ${r.querySelector("b").textContent.toUpperCase().padEnd(5)}  ${r.querySelector("span").textContent}`).join("\n");
        if (a === "copy") copy(text());
        if (a === "download") save(`${tab}-logs.txt`, text());
      }));
    }, { align: "right" });
  };

  load().then(() => { timer = setInterval(poll, 2500); });
  return () => { stopped = true; clearInterval(timer); };
}

function emptyText(tab, total, needle) {
  if (needle) return "No lines match your search.";
  if (!total) return "Nothing printed yet. Anything your app writes to the console shows up here.";
  if (tab === "errors") return `${icon("check")} No errors or warnings in the last ${total.toLocaleString()} lines.`;
  if (tab === "debug") return "No debug lines. Lines with DEBUG or TRACE, or JSON logs with a debug level, show up here.";
  return "Nothing to show with these filters.";
}

// "2026-11-21T17:03:09.123Z" → "17:03:09" in your time zone.
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

// Highlight the search word in a line (escaped first, so the line can't add HTML).
function mark(text, needle) {
  if (!needle) return esc(text);
  const lower = text.toLowerCase();
  let out = "", i = 0, at;
  while ((at = lower.indexOf(needle, i)) !== -1) {
    out += esc(text.slice(i, at)) + `<mark>${esc(text.slice(at, at + needle.length))}</mark>`;
    i = at + needle.length;
  }
  return out + esc(text.slice(i));
}

function save(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Deploys -------------------------------------------------------------

function deploysTab(el, base, app) {
  if (!app.deploys.length) { el.innerHTML = `<div class="card pad muted">No deploys yet. Their build logs show up here.</div>`; return; }
  let timer = null;
  el.innerHTML = `
    <div class="logsplit">
      <div class="card loglist">${app.deploys.map((d) => `
        <button data-id="${d.id}"><span class="status ${esc(d.status)}"></span>
          <span class="grow"><b>Version #${d.id}</b>${d.current ? ` <span class="badge">Running</span>` : ""}<span class="note">${timeAgo(d.created_at)} · ${esc(d.status)}</span></span></button>`).join("")}</div>
      <div class="logview-wrap"><div class="logview wrap notime" id="view"></div></div>
    </div>`;
  const view = el.querySelector("#view");

  async function open(id) {
    clearInterval(timer);
    el.querySelectorAll("[data-id]").forEach((b) => b.classList.toggle("on", b.dataset.id === String(id)));
    const draw = (d) => {
      const follow = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
      view.innerHTML = (d.log || (d.status === "building" ? "Starting…" : "(empty log)")).split("\n").map((t) =>
        `<div class="ll ${buildLevel(t)}"><span>${esc(t)}</span></div>`).join("");
      if (follow) view.scrollTop = view.scrollHeight;
    };
    const d = await api(`${base}/deploys/${id}`);
    draw(d); view.scrollTop = view.scrollHeight;
    // Still building: follow along.
    if (d.status === "building") timer = setInterval(async () => {
      const now = await api(`${base}/deploys/${id}`).catch(() => null);
      if (now) draw(now);
      if (!now || now.status !== "building") clearInterval(timer);
    }, 2000);
  }
  el.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => open(b.dataset.id)));
  open(app.deploys[0].id);
  return () => clearInterval(timer);
}

// Build log lines: steps ("→ …") stand out, failures are red.
export const buildLevel = (t) => /^\s*(→|==>|#\d+ \[)/.test(t) ? "step"
  : /\b(error|failed|fatal|exited with code [1-9])\b/i.test(t) ? "error"
  : /\bwarn(ing)?\b/i.test(t) ? "warn" : "info";

// --- Cron jobs -----------------------------------------------------------

async function cronsTab(el, base) {
  const runs = await api(`${base}/logs/crons`);
  if (!runs.length) { el.innerHTML = `<div class="card pad muted">No cron runs yet. Add a job under Crons; each run's output shows up here.</div>`; return; }
  const pill = { ok: "ok", failed: "bad", running: "info", skipped: "warn" };
  el.innerHTML = `<div class="card">${runs.map((r) => `
    <details class="ver cronrun">
      <summary>
        <span class="chev">${icon("chevron")}</span>
        <span class="pill ${pill[r.status] ?? ""}">${esc(r.status)}</span>
        <span class="grow"><b>${esc(r.job)}</b>${r.attempts > 1 ? ` <span class="note">${r.attempts} tries</span>` : ""}</span>
        <span class="muted">${r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s · ` : ""}${timeAgo(r.started_at)}</span>
      </summary>
      <div class="verbody"><pre class="log">${esc(r.output || "(no output)")}</pre></div>
    </details>`).join("")}</div>`;
}
