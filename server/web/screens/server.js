// System: machine info, usage meters, and every Docker container.
import { api, esc, icon, toast, bytes } from "../app.js";
import { lineChart } from "../chart.js";
import { rangePicker } from "./ranges.js";

export async function serverScreen(page) {
  // Live numbers redraw every 10s; the history charts only when needed, so hovering isn't interrupted.
  page.innerHTML = `<div id="live"></div><div id="history"></div>`;
  const view = page.querySelector("#live");
  const stopHistory = await history(page.querySelector("#history"));

  async function draw() {
    const s = await api("/api/server");
    const mem = s.memory.used / s.memory.total, disk = s.disk.used / (s.disk.total || 1);
    const load = s.load[0] / s.cpus;
    view.innerHTML = `
      <div class="row spread head"><h1>System</h1><span class="muted">${esc(s.hostname)} · ${esc(s.ip)}</span></div>
      <div class="stats">
        ${meter("CPU load", `${Math.round(load * 100)}%`, `${s.cpus} cores`, load, "#/system/cpu")}
        ${meter("Memory", bytes(s.memory.used), `of ${bytes(s.memory.total)}`, mem, "#/system/memory")}
        ${meter("Disk", bytes(s.disk.used), `of ${bytes(s.disk.total)}`, disk)}
        <div class="card stat"><b>${uptime(s.uptime)}</b><span>uptime</span></div>
      </div>
      <div class="card pad" style="margin-bottom:14px">
        <dl class="info">
          <dt>System</dt><dd>${esc(s.os)}</dd>
          <dt>Processor</dt><dd>${esc(s.cpuModel)}</dd>
          <dt>Load (1/5/15 min)</dt><dd>${s.load.map((l) => l.toFixed(2)).join(" · ")}</dd>
          <dt>Docker</dt><dd>${esc(s.docker)}</dd>
          <dt>Node.js</dt><dd>${esc(s.node)}</dd>
        </dl>
      </div>
      <div class="row spread" style="margin:22px 0 10px"><b>Running services</b><span class="muted">${s.containers.length} containers</span></div>
      <div class="card scroll">
        <table>
          <tr><th>Name</th><th>State</th><th>CPU</th><th>Memory</th><th>Image</th><th></th></tr>
          ${s.containers.map((ct) => `
            <tr>
              <td><b>${esc(ct.name)}</b><div class="note">${esc(label(ct.name))}</div></td>
              <td><span class="status ${ct.state === "running" ? "live" : "failed"}">${esc(ct.status)}</span></td>
              <td>${esc(ct.cpu || "—")}</td>
              <td>${esc(ct.memory || "—")}</td>
              <td class="note">${esc(ct.image)}</td>
              <td><button class="btn" data-restart="${esc(ct.name)}" title="Restart">${icon("restart")}</button></td>
            </tr>`).join("")}
        </table>
      </div>`;

    view.querySelectorAll("[data-restart]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`Restart ${b.dataset.restart}?`)) return;
      b.disabled = true;
      try { await api(`/api/server/containers/${encodeURIComponent(b.dataset.restart)}/restart`, { method: "POST" }); toast("Restarted"); draw(); }
      catch (err) { toast(err.message); b.disabled = false; }
    }));
  }
  await draw();
  const timer = setInterval(() => draw().catch(() => {}), 10000);
  return () => { clearInterval(timer); stopHistory(); };
}

// Plain-language name for each container.
function label(name) {
  if (name.startsWith("app-")) return "Your app";
  return { caddy: "Web server & HTTPS", postgres: "Database", garage: "File storage", buildkit: "App builder" }[name] ?? "";
}

// A usage card. With `href`, it links to a detail page.
function meter(title, big, small, ratio, href) {
  const c = ratio > 0.9 ? "var(--bad)" : ratio > 0.75 ? "var(--warn)" : "var(--accent)";
  const tag = href ? "a" : "div";
  return `<${tag} class="card stat ${href ? "link" : ""}" ${href ? `href="${href}"` : ""}>
    <span class="row spread">${title}${href ? `<span class="more">Details ${icon("chevron")}</span>` : ""}</span>
    <b>${big}</b><span>${small}</span>
    <div class="meter" style="--c:${c}"><i style="width:${Math.min(100, Math.round(ratio * 100))}%"></i></div></${tag}>`;
}

function uptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`;
}

// CPU, memory and disk over time.
async function history(el) {
  let range = "24h", timer;
  async function draw() {
    const d = await api(`/api/metrics/server?range=${range}`);
    el.innerHTML = `
      <div class="row spread" style="margin:26px 0 10px"><b>History</b><span id="ranges"></span></div>
      <div class="charts">
        <div class="card pad"><div class="chart-title">CPU</div><div data-c="cpu"></div></div>
        <div class="card pad"><div class="chart-title">Memory</div><div data-c="mem"></div></div>
        <div class="card pad"><div class="chart-title">Disk</div><div data-c="disk"></div></div>
      </div>`;
    rangePicker(el.querySelector("#ranges"), range, (r) => { range = r; clearTimeout(timer); draw(); });
    for (const k of ["cpu", "mem", "disk"]) lineChart(el.querySelector(`[data-c="${k}"]`), d[k], { format: (v) => `${Math.round(v)}%`, max: 100 });
    timer = setTimeout(() => draw().catch(() => {}), 60000);
  }
  await draw();
  return () => clearTimeout(timer);
}
