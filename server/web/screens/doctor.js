// Server Doctor. Problems first, each with one clear action. Fixes run inside
// their own card: what it will do → progress → result. Passed checks stay out of the way.
import { api, esc, icon, toast, timeAgo } from "../app.js";

export async function doctorScreen(view) {
  let timer, data = null, history = [];
  const open = { fix: null, passed: false, history: false }; // what the user has opened

  async function load() {
    try {
      [data, history] = await Promise.all([api("/api/doctor"), api("/api/doctor/history").catch(() => [])]);
    } catch {
      view.innerHTML = `<div class="loading"><span class="spinner"></span>Reconnecting to your server…</div>`;
      timer = setTimeout(load, 4000); // e.g. during a server restart
      return;
    }
    if (open.fix?.state === "running" && !data.fixing) finishFix(); // the fix we're watching just ended
    draw();
    timer = setTimeout(load, data.fixing || data.checking ? 2500 : 30000);
  }
  const reload = () => { clearTimeout(timer); load(); };

  function draw() {
    const r = data;
    const attention = r.items.filter((i) => i.status === "bad" || i.status === "warn");
    const info = r.items.filter((i) => i.status === "info");
    const passed = r.items.filter((i) => i.status === "ok");
    const when = r.checkedAt ? timeAgo(r.checkedAt.replace("T", " ").slice(0, 19)) : null;

    view.innerHTML = `
      <div class="head"><h1>Server Doctor</h1></div>

      <div class="doc-summary ${attention.length ? (attention.some((i) => i.status === "bad") ? "bad" : "warn") : "ok"}">
        <span class="doc-score" title="Health score: 100 when all is well">${r.score}</span>
        <div class="grow">
          <b>${!when ? "Running the first check…" : attention.length ? `${attention.length} thing${attention.length === 1 ? " needs" : "s need"} your attention` : "Everything looks good"}</b>
          <span class="muted">${when ? `Checked ${when}. Runs by itself every 10 minutes.` : "This takes a few seconds."}</span>
        </div>
        <button class="btn" id="recheck" ${r.checking ? "disabled" : ""}>${r.checking ? `<span class="spinner sm"></span> Checking…` : "Check again"}</button>
      </div>

      ${attention.length ? `
        <h3 class="doc-h">Needs attention</h3>
        <div class="doc-list">${attention.map(card).join("")}</div>` : ""}

      ${info.length ? `
        <h3 class="doc-h">Good to know</h3>
        <div class="doc-list">${info.map(card).join("")}</div>` : ""}

      ${passed.length ? `
        <button class="doc-toggle" data-open="passed"><span class="chev ${open.passed ? "open" : ""}">${icon("chevron")}</span>
          ${passed.length} check${passed.length === 1 ? "" : "s"} passed</button>
        ${open.passed ? `<div class="card doc-passed">${passed.map((i) => `
          <div><span class="tick">${icon("check")}</span><b>${esc(i.title)}</b><span class="muted">${esc(i.message)}</span></div>`).join("")}</div>` : ""}` : ""}

      ${history.length ? `
        <button class="doc-toggle" data-open="history"><span class="chev ${open.history ? "open" : ""}">${icon("chevron")}</span>
          Recent fixes</button>
        ${open.history ? `<div class="card doc-passed">${history.map((h) => `
          <details><summary><span class="status ${h.status === "done" ? "live" : h.status === "running" ? "building" : "failed"}">${h.status === "done" ? "done" : esc(h.status)}</span>
            <b>${esc(h.title)}</b><span class="muted">${timeAgo(h.started_at)}</span></summary>
            <pre class="log">${esc(h.output || "…")}</pre></details>`).join("")}</div>` : ""}` : ""}`;

    view.querySelector("#recheck").onclick = async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.innerHTML = `<span class="spinner sm"></span> Checking…`;
      await api("/api/doctor/check", { method: "POST" }).catch((err) => toast(err.message));
      reload();
    };
    view.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { open[b.dataset.open] = !open[b.dataset.open]; draw(); }));
    view.querySelectorAll("[data-fix]").forEach((b) => (b.onclick = () => askFix(b.dataset.fix)));
    view.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => { open.fix = null; draw(); }));
    view.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => runFix()));
  }

  // One check as a card. The open fix (if it's this one) shows inside it.
  function card(i) {
    const f = open.fix?.id === i.id ? open.fix : null;
    const busy = data.fixing && data.fixing !== i.id;
    return `
      <div class="card doc-card ${i.status}">
        <div class="doc-main">
          <span class="doc-ico">${icon(i.status === "info" ? "info" : "alert")}</span>
          <div class="grow">
            <b>${esc(i.title)}</b>
            <p>${esc(i.message)}</p>
            ${i.detail ? `<p class="muted">${esc(i.detail)}</p>` : ""}
          </div>
          <div class="doc-actions">
            ${i.link ? `<a class="btn" href="${esc(i.link)}">${i.link.includes("/logs") ? "See logs" : "Open"}</a>` : ""}
            ${i.fix && !f ? `<button class="btn ${i.status === "bad" ? "primary" : ""}" data-fix="${esc(i.id)}" ${busy ? 'disabled title="Another fix is running"' : ""}>${esc(i.fix)}</button>` : ""}
          </div>
        </div>
        ${f ? fixPanel(f) : ""}
      </div>`;
  }

  function fixPanel(f) {
    if (f.state === "loading") return `<div class="doc-fix"><span class="spinner sm"></span> Checking what this will do…</div>`;
    if (f.state === "confirm") return `
      <div class="doc-fix">
        <p class="muted">This will:</p>
        <ul>${f.description.split("\n").map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <div class="row" style="justify-content:flex-end"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-run>${esc(f.label)}</button></div>
      </div>`;
    const log = history.find((h) => h.id === f.logId)?.output ?? "";
    if (f.state === "running") return `
      <div class="doc-fix"><p><span class="spinner sm"></span> ${esc(f.label)}…</p>${log ? `<pre class="log">${esc(log)}</pre>` : ""}</div>`;
    return `
      <div class="doc-fix ${f.state}">
        <p><b>${f.state === "done" ? "✓ Done." : "That didn't work."}</b> ${f.state === "done" ? "Checking again…" : ""}</p>
        ${log ? `<pre class="log">${esc(log)}</pre>` : ""}
        <div class="row" style="justify-content:flex-end"><button class="btn" data-cancel>Close</button></div>
      </div>`;
  }

  async function askFix(id) {
    open.fix = { id, state: "loading" }; draw();
    try {
      const d = await api(`/api/doctor/fix/${id}`);
      open.fix = { id, state: "confirm", label: d.label, description: d.description };
    } catch (err) { toast(err.message); open.fix = null; }
    draw();
  }

  async function runFix() {
    const f = open.fix;
    try {
      await api(`/api/doctor/fix/${f.id}`, { method: "POST" });
      const h = await api("/api/doctor/history").catch(() => []);
      f.logId = h[0]?.id; f.state = "running";
    } catch (err) { toast(err.message); open.fix = null; }
    reload();
  }

  function finishFix() {
    const h = history.find((x) => x.id === open.fix.logId);
    open.fix.state = h?.status === "done" ? "done" : "failed";
    // Fixed problems leave "Needs attention" on the next check; keep the result visible until then.
    if (open.fix.state === "done" && !data.items.some((i) => i.id === open.fix.id && i.status !== "ok")) {
      toast("Fixed"); open.fix = null;
    }
  }

  await load();
  return () => clearTimeout(timer);
}
