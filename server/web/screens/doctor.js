// Doctor: health score, checks with Fix buttons, and a history of fixes.
import { api, esc, icon, toast, timeAgo } from "../app.js";

const LABEL = { bad: "Problem", warn: "Warning", info: "Info", ok: "Good" };

export async function doctorScreen(view) {
  let timer;
  async function draw() {
    let r;
    try { r = await api("/api/doctor"); }
    catch { view.innerHTML = reconnecting(); timer = setTimeout(draw, 4000); return; } // e.g. during a restart
    const hist = await api("/api/doctor/history").catch(() => []);
    const open = new Set([...view.querySelectorAll("details[open]")].map((d) => d.dataset.id));

    view.innerHTML = `
      <div class="row spread head">
        <h1>Server Doctor</h1>
        <button class="btn" id="check" ${r.checking ? "disabled" : ""}>${icon("restart")} ${r.checking ? "Checking…" : "Check now"}</button>
      </div>
      <div class="card pad doc-top">
        ${ring(r.score)}
        <div>
          <b style="font-size:17px">${r.issues ? `${r.issues} thing${r.issues === 1 ? "" : "s"} need${r.issues === 1 ? "s" : ""} attention` : "Your server is healthy"}</b>
          <p class="muted">${r.checkedAt ? `Checked ${timeAgo(r.checkedAt.replace("T", " ").slice(0, 19))}. Checks run every 10 minutes.` : "Running the first check…"}</p>
          ${r.fixing ? `<p class="note" style="margin-top:6px"><span class="spinner" style="display:inline-block;width:12px;height:12px;vertical-align:-2px"></span> Fixing: ${esc(r.items.find((i) => i.id === r.fixing)?.title ?? r.fixing)}…</p>` : ""}
        </div>
      </div>
      <div class="checks">${r.items.map((i) => `
        <div class="card check ${i.status}">
          <span class="dot">${icon(i.status === "ok" ? "check" : i.status === "info" ? "info" : "alert")}</span>
          <div class="grow">
            <div class="row" style="gap:8px"><b>${esc(i.title)}</b><span class="pill ${i.status}">${LABEL[i.status]}</span></div>
            <div>${esc(i.message)}</div>
            ${i.detail ? `<div class="note">${esc(i.detail)}</div>` : ""}
          </div>
          ${i.link ? `<a class="btn" href="${esc(i.link)}">See logs</a>` : ""}
          ${i.fix ? `<button class="btn ${i.status === "bad" ? "primary" : ""}" data-fix="${esc(i.id)}" ${r.fixing ? "disabled" : ""}>${esc(i.fix)}</button>` : ""}
        </div>`).join("")}
      </div>
      ${hist.length ? `
        <div class="row spread" style="margin:24px 0 10px"><b>Fix history</b></div>
        <div class="card">${hist.map((h) => `
          <details class="ver" data-id="${h.id}" ${open.has(String(h.id)) || h.status === "running" ? "open" : ""}>
            <summary>
              <span class="chev">${icon("chevron")}</span>
              <span class="status ${h.status === "done" ? "live" : h.status === "running" ? "building" : "failed"}">${esc(h.status)}</span>
              <span class="grow">${esc(h.title)}</span>
              <span class="muted">${timeAgo(h.started_at)}</span>
            </summary>
            <pre class="log" style="margin:0 18px 14px">${esc(h.output || "…")}</pre>
          </details>`).join("")}
        </div>` : ""}`;

    view.querySelector("#check").onclick = async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Checking…";
      await api("/api/doctor/check", { method: "POST" }).catch((err) => toast(err.message));
      draw();
    };
    view.querySelectorAll("[data-fix]").forEach((b) => (b.onclick = () => confirmFix(b.dataset.fix, draw)));

    // Poll faster while something is happening.
    timer = setTimeout(draw, r.fixing || r.checking ? 2500 : 30000);
  }
  await draw();
  return () => clearTimeout(timer);
}

// Show exactly what a fix will do, then run it.
async function confirmFix(id, done) {
  let info;
  try { info = await api(`/api/doctor/fix/${id}`); } catch (err) { toast(err.message); return; }
  const modal = document.createElement("div");
  modal.className = "overlay";
  modal.innerHTML = `
    <div class="modal card">
      <h2>${esc(info.label)}</h2>
      <div>
        <p class="muted" style="margin-bottom:8px">This will:</p>
        <ul class="will">${info.description.split("\n").map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="go">${esc(info.label)}</button>
      </div>
    </div>`;
  document.body.append(modal);
  modal.onclick = (e) => { if (e.target === modal || e.target.closest("[data-close]")) modal.remove(); };
  modal.querySelector("#go").onclick = async () => {
    try { await api(`/api/doctor/fix/${id}`, { method: "POST" }); toast("Started"); }
    catch (err) { toast(err.message); }
    modal.remove(); done();
  };
}

function ring(score) {
  const c = score >= 90 ? "var(--ok)" : score >= 60 ? "var(--warn)" : "var(--bad)";
  const off = 264 - (264 * score) / 100;
  return `<svg class="ring" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" stroke-width="9"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="264" stroke-dashoffset="${off}" transform="rotate(-90 50 50)"/>
    <text x="50" y="50" text-anchor="middle" dominant-baseline="central">${score}</text></svg>`;
}

const reconnecting = () => `
  <div class="loading"><span class="spinner"></span>Reconnecting to your server…</div>`;
