// Server: machine info, usage meters, and every Docker container.
import { api, esc, icon, toast, bytes } from "../app.js";

export async function serverScreen(view) {
  async function draw() {
    const s = await api("/api/server");
    const mem = s.memory.used / s.memory.total, disk = s.disk.used / (s.disk.total || 1);
    const load = s.load[0] / s.cpus;
    view.innerHTML = `
      <div class="row spread head"><h1>Server</h1><span class="muted">${esc(s.hostname)} · ${esc(s.ip)}</span></div>
      <div class="stats">
        ${meter("CPU load", `${Math.round(load * 100)}%`, `${s.cpus} cores`, load)}
        ${meter("Memory", bytes(s.memory.used), `of ${bytes(s.memory.total)}`, mem)}
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
  return () => clearInterval(timer);
}

// Plain-language name for each container.
function label(name) {
  if (name.startsWith("app-")) return "Your app";
  return { caddy: "Web server & HTTPS", postgres: "Database", garage: "File storage", buildkit: "App builder" }[name] ?? "";
}

function meter(title, big, small, ratio) {
  const c = ratio > 0.9 ? "var(--bad)" : ratio > 0.75 ? "var(--warn)" : "var(--accent)";
  return `<div class="card stat"><span>${title}</span><b>${big}</b><span>${small}</span>
    <div class="meter" style="--c:${c}"><i style="width:${Math.min(100, Math.round(ratio * 100))}%"></i></div></div>`;
}

function uptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`;
}
