// CPU or Memory detail: every process on the server, busiest first. Refreshes every 3 seconds.
import { api, esc, icon, bytes } from "../app.js";

export async function processesScreen(view, kind) {
  const isCpu = kind !== "memory";
  let timer, filter = "";
  // Click a column title to sort by it; click again to flip the order.
  let sort = { key: isCpu ? "cpu" : "memory", dir: -1 };

  async function draw() {
    const d = await api(`/api/server/processes?sort=${isCpu ? "cpu" : "memory"}`);
    const keepFocus = document.activeElement?.id === "filter";
    const rows = d.processes
      .filter((p) => !filter || `${p.name} ${p.command} ${p.owner} ${p.user}`.toLowerCase().includes(filter))
      .sort((x, y) => compare(x[sort.key], y[sort.key]) * sort.dir)
      .slice(0, 100);
    const th = (key, label, right) => `<th class="sortable ${sort.key === key ? "on" : ""}" data-sort="${key}" ${right ? 'style="text-align:right"' : ""}>
      ${label}<span class="arrow">${sort.key === key ? (sort.dir < 0 ? "↓" : "↑") : ""}</span></th>`;

    view.innerHTML = `
      <a href="#/system" class="btn" style="border:0;padding-left:0;margin-top:8px">${icon("back")} System</a>
      <div class="row spread head">
        <h1>${isCpu ? "CPU" : "Memory"}</h1>
        <span class="muted">${d.count} processes · live</span>
      </div>
      ${isCpu ? cpuTop(d) : memTop(d)}
      <div class="row spread" style="margin:22px 0 10px">
        <b>Processes <span class="muted" style="font-weight:400">(top 100)</span></b>
        <input id="filter" placeholder="Filter…" value="${esc(filter)}" style="max-width:220px">
      </div>
      <div class="card scroll">
        <table>
          <tr>${th("name", "Process")}${th("owner", "Belongs to")}${th("cpu", "CPU", true)}${th("memory", "Memory", true)}${th("user", "User")}${th("pid", "PID")}</tr>
          ${rows.map((p) => `
            <tr>
              <td style="max-width:420px"><b>${esc(p.name)}</b><div class="note" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.command)}">${esc(p.command)}</div></td>
              <td>${p.owner ? `<span class="badge">${esc(p.owner)}</span>` : `<span class="muted">System</span>`}</td>
              <td style="text-align:right;white-space:nowrap">${bar(p.cpu, 100)}${p.cpu.toFixed(1)}%</td>
              <td style="text-align:right;white-space:nowrap">${bar(p.memory, d.memory.total)}${bytes(p.memory)}</td>
              <td class="muted">${esc(p.user)}</td>
              <td class="muted">${p.pid}</td>
            </tr>`).join("")}
        </table>
      </div>
      <p class="note" style="margin-top:8px">${isCpu ? "CPU is measured over the last second. 100% = one full core." : "Memory is the real memory each process uses (RSS)."}</p>`;

    view.querySelectorAll("[data-sort]").forEach((h) => (h.onclick = () => {
      const key = h.dataset.sort;
      // Numbers start biggest-first, text starts A→Z.
      sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: ["cpu", "memory"].includes(key) ? -1 : 1 };
      clearTimeout(timer); draw();
    }));
    const input = view.querySelector("#filter");
    input.oninput = () => { filter = input.value.toLowerCase(); clearTimeout(timer); draw(); };
    if (keepFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    timer = setTimeout(() => draw().catch(() => {}), 3000);
  }

  await draw();
  return () => clearTimeout(timer);
}

// Numbers by value, text alphabetically (empty last).
const compare = (a, b) =>
  typeof a === "number" ? a - b : !a ? 1 : !b ? -1 : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

// Small inline bar next to a number.
const bar = (v, max) => `<span class="minibar"><i style="width:${Math.min(100, (v / (max || 1)) * 100)}%"></i></span>`;

function cpuTop(d) {
  const avg = Math.round(d.cores.reduce((a, b) => a + b, 0) / (d.cores.length || 1));
  return `
    <div class="stats">
      <div class="card stat"><b>${avg}%</b><span>average across ${d.cores.length} core${d.cores.length === 1 ? "" : "s"}</span></div>
      <div class="card stat"><b>${d.load.map((l) => l.toFixed(2)).join(" · ")}</b><span>load (1 / 5 / 15 min)</span></div>
    </div>
    <div class="card pad">
      <b>Cores</b>
      <div class="cores">${d.cores.map((c, i) => `
        <div><span class="note">Core ${i + 1}</span><div class="meter" style="--c:${color(c)}"><i style="width:${c}%"></i></div><span class="note">${c}%</span></div>`).join("")}
      </div>
    </div>`;
}

function memTop(d) {
  const m = d.memory;
  const pct = (v) => (v / m.total) * 100;
  const apps = Math.max(0, m.used);
  return `
    <div class="stats">
      <div class="card stat"><b>${bytes(m.used)}</b><span>used by programs</span></div>
      <div class="card stat"><b>${bytes(m.available)}</b><span>available</span></div>
      <div class="card stat"><b>${bytes(m.total)}</b><span>total</span></div>
      <div class="card stat"><b>${m.swapTotal ? bytes(m.swapUsed) : "Off"}</b><span>${m.swapTotal ? `swap used of ${bytes(m.swapTotal)}` : "swap"}</span></div>
    </div>
    <div class="card pad">
      <b>Breakdown</b>
      <div class="stack">
        <i style="width:${pct(apps)}%;background:var(--accent)" title="Programs"></i>
        <i style="width:${Math.max(0, pct(m.cache) - 0)}%;background:color-mix(in srgb, var(--accent) 35%, transparent)" title="Cache"></i>
      </div>
      <div class="row" style="gap:18px;margin-top:10px;font-size:13px">
        <span><span class="sw" style="background:var(--accent)"></span>Programs ${bytes(apps)}</span>
        <span><span class="sw" style="background:color-mix(in srgb, var(--accent) 35%, transparent)"></span>Cache ${bytes(m.cache)}</span>
        <span class="muted">Cache is freed automatically when programs need it.</span>
      </div>
    </div>`;
}

const color = (v) => (v > 90 ? "var(--bad)" : v > 75 ? "var(--warn)" : "var(--accent)");
