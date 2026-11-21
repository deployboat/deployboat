// App → Versions: every deploy of the app, newest first.
//
// On top, what's live now. Below, a table: version, status, where it came from (a Git push,
// the CLI…), when and how long it took, and actions: see the build log, or switch the live
// site to that version (roll back). A version that's building shows its log live.
import { api, esc, icon, toast, timeAgo } from "../app.js";
import { buildLevel } from "./logs.js";

const STATUS = { live: ["ok", "Built"], failed: ["bad", "Failed"], building: ["info", "Building"] };

// "2026-11-21 10:00:00" (database time, UTC) → a Date.
const toDate = (sql) => (sql ? new Date(sql.replace(" ", "T") + "Z") : null);

function took(d) {
  const a = toDate(d.created_at), b = toDate(d.finished_at);
  if (!a || !b) return "";
  const s = Math.max(0, Math.round((b - a) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// Where it came from, short: "Git push", "CLI", "Redeploy"… with the commit when there is one.
function origin(d) {
  const via = d.source ?? "";
  const kind = /^Push to/.test(via) ? ["git", "Git push"]
    : /Redeploy/i.test(via) ? ["restart", "Redeploy"]
    : /Git/i.test(via) ? ["git", "From Git"]
    : /pull request|PR #/i.test(via) ? ["git", "Pull request"]
    : via ? ["upload", "CLI upload"] : ["box", "Deploy"];
  const [sha, ...msg] = (d.git_commit ?? "").split(" ");
  return `<span class="vsrc">${icon(kind[0])}<span class="grow"><span>${kind[1]}</span>
    ${d.git_commit ? `<span class="vcommit"><code>${esc(sha)}</code> ${esc(msg.join(" "))}</span>` : ""}</span></span>`;
}

export async function versionsPage(box, base, app) {
  let deploys = app.deploys;
  const openLogs = new Set(); // version ids whose log is shown
  let timer = null;

  box.innerHTML = `<div id="now"></div><div id="table"></div>`;

  function draw() {
    const current = deploys.find((d) => d.current);
    const building = deploys.find((d) => d.status === "building");
    box.querySelector("#now").innerHTML = `
      <div class="card vnow">
        <span class="vnow-icon ${current ? "ok" : ""}">${icon(current ? "check" : "box")}</span>
        <div class="grow">
          <span class="note">Live now</span>
          <b>${current ? `Version #${current.id}` : "No version running"}</b>
          ${current ? `<span class="note">${current.git_commit ? `<code>${esc(current.git_commit.split(" ")[0])}</code> ${esc(current.git_commit.split(" ").slice(1).join(" "))} · ` : ""}built ${timeAgo(current.created_at)}</span>` : ""}
        </div>
        ${building ? `<span class="pill info"><span class="spinner sm"></span> Version #${building.id} is building</span>` : ""}
        ${app.git ? `<button class="btn primary" id="redeploy" ${building ? "disabled" : ""}>${icon("git")} Pull &amp; redeploy</button>` : ""}
      </div>`;
    box.querySelector("#redeploy")?.addEventListener("click", redeploy);

    if (!deploys.length) {
      box.querySelector("#table").innerHTML = `<div class="card pad muted" style="margin-top:14px">No versions yet. Each deploy makes one, so you can see its log and go back to it.</div>`;
      return;
    }
    box.querySelector("#table").innerHTML = `
      <div class="card vtable">
        <div class="vhead"><span>Version</span><span>Status</span><span>Source</span><span>When</span><span></span></div>
        ${deploys.map(row).join("")}
      </div>
      <p class="note" style="margin-top:10px">Rolling back switches the live site to an older build in seconds. Your data, variables and domains stay as they are.</p>`;
    box.querySelectorAll("[data-log]").forEach((b) => (b.onclick = () => {
      const id = Number(b.dataset.log);
      openLogs.has(id) ? openLogs.delete(id) : openLogs.add(id);
      draw();
    }));
    box.querySelectorAll("[data-use]").forEach((b) => (b.onclick = () => rollBack(b)));
    box.querySelectorAll("[data-logbox]").forEach(loadLog);
  }

  function row(d) {
    const [kind, label] = STATUS[d.status] ?? ["plain", d.status];
    const open = openLogs.has(d.id);
    return `
      <div class="vrow ${d.current ? "current" : ""}">
        <div class="vcell"><b>#${d.id}</b>${d.current ? `<span class="badge">Live</span>` : ""}</div>
        <div class="vcell"><span class="pill ${kind}">${d.status === "building" ? `<span class="spinner sm"></span> ` : ""}${label}</span></div>
        <div class="vcell">${origin(d)}</div>
        <div class="vcell"><span title="${esc(toDate(d.created_at)?.toLocaleString() ?? "")}">${timeAgo(d.created_at)}</span>
          ${took(d) ? `<span class="note">took ${took(d)}</span>` : ""}</div>
        <div class="vcell vacts">
          <button class="btn ghost" data-log="${d.id}">${icon("term")} ${open ? "Hide log" : "Log"}</button>
          ${d.current ? `<span class="vlive">Running</span>`
            : d.canActivate ? `<button class="btn" data-use="${d.id}">${icon("history")} Roll back</button>`
            : `<button class="btn" disabled title="${d.status === "live" ? "Built before rollback existed, or cleaned up" : "This version didn't build"}">${icon("history")} Roll back</button>`}
        </div>
      </div>
      ${open ? `<div class="vlog"><div class="logview wrap notime" data-logbox="${d.id}"><div class="logempty">Loading…</div></div></div>` : ""}`;
  }

  // Fill a version's log. Lines are colored like on the Logs page: steps, warnings, errors.
  async function loadLog(el) {
    const r = await api(`${base}/deploys/${el.dataset.logbox}`).catch(() => null);
    if (!r || !el.isConnected) return;
    const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = (r.log || (r.status === "building" ? "Starting…" : "(empty log)")).split("\n")
      .map((t) => `<div class="ll ${buildLevel(t)}"><span>${esc(t)}</span></div>`).join("");
    if (follow || !el.dataset.seen) el.scrollTop = el.scrollHeight;
    el.dataset.seen = "1";
  }

  async function rollBack(b) {
    if (!confirm(`Switch the live site to version #${b.dataset.use}?\n\nIt takes a few seconds. You can switch back any time.`)) return;
    b.disabled = true; b.innerHTML = `<span class="spinner sm"></span> Switching…`;
    try {
      await api(`${base}/versions/${b.dataset.use}/activate`, { method: "POST" });
      toast(`Now running version #${b.dataset.use}`);
    } catch (err) { toast(err.message); }
    refresh();
  }

  async function redeploy(e) {
    e.currentTarget.disabled = true;
    try { await api(`/api/git/redeploy/${encodeURIComponent(app.name)}`, { method: "POST" }); toast("Deploy started"); }
    catch (err) { toast(err.message); }
    setTimeout(refresh, 1200);
  }

  async function refresh() {
    const fresh = await api(base).catch(() => null);
    if (!fresh || !box.isConnected) return;
    const wasBuilding = deploys.find((d) => d.status === "building");
    // Nothing new? Only update the log of a version that's building (keeps your scroll place).
    if (JSON.stringify(fresh.deploys) === JSON.stringify(deploys)) {
      if (wasBuilding) box.querySelectorAll(`[data-logbox="${wasBuilding.id}"]`).forEach(loadLog);
      return;
    }
    deploys = fresh.deploys;
    const building = deploys.find((d) => d.status === "building");
    if (building) openLogs.add(building.id); // show the build as it happens
    if (wasBuilding && !building) toast(deploys.find((d) => d.id === wasBuilding.id)?.status === "live" ? `Version #${wasBuilding.id} is live` : `Version #${wasBuilding.id} failed. See its log.`);
    draw();
  }

  const building = deploys.find((d) => d.status === "building");
  if (building) openLogs.add(building.id);
  draw();
  // While something is building, follow it. Otherwise check now and then (a push may start one).
  timer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  return () => clearInterval(timer);
}
