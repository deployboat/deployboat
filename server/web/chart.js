// A small line chart in plain SVG: one series, thin line, soft fill, faint grid,
// and a crosshair + tooltip on hover. Usage:
//   lineChart(el, [[time, value], …], { format: (v) => `${v}%`, max: 100 })
import { esc } from "./app.js";

const H = 140, PAD = { top: 10, right: 12, bottom: 22, left: 44 };

export function lineChart(el, points, { format = (v) => String(v), max, min = 0 } = {}) {
  const W = Math.max(280, el.clientWidth || 600);
  if (!points.length) {
    el.innerHTML = `<div class="chart-empty">No data yet. Points appear every minute.</div>`;
    return;
  }
  const t0 = points[0][0], t1 = points.at(-1)[0] || t0 + 1;
  const top = niceMax(max ?? Math.max(...points.map((p) => p[1]), 1));
  const x = (t) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - min) / (top - min)) * (H - PAD.top - PAD.bottom);

  // Gaps longer than 3 steps (server was off) break the line instead of joining it.
  const step = points.length > 1 ? (t1 - t0) / (points.length - 1) : 1;
  let d = "";
  points.forEach(([t, v], i) => {
    const gap = i && t - points[i - 1][0] > step * 3;
    d += `${!i || gap ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const area = `M${x(t0)},${y(min)}${d.replace(/^M/, "L")}L${x(t1)},${y(min)}Z`;

  const grid = [0, 0.5, 1].map((f) => {
    const v = min + (top - min) * f;
    return `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(format(v))}</text>`;
  }).join("");
  const xLabels = [t0, (t0 + t1) / 2, t1].map((t, i) =>
    `<text x="${x(t)}" y="${H - 6}" text-anchor="${["start", "middle", "end"][i]}" class="axis">${timeLabel(t, t1 - t0)}</text>`).join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart" role="img">
      ${grid}${xLabels}
      <path d="${area}" class="fill"/>
      <path d="${d}" class="line"/>
      <line class="cross" y1="${PAD.top}" y2="${H - PAD.bottom}" visibility="hidden"/>
      <circle class="dot" r="4" visibility="hidden"/>
      <rect x="${PAD.left}" y="0" width="${W - PAD.left - PAD.right}" height="${H}" fill="transparent" class="hit"/>
    </svg>
    <div class="tip" hidden></div>`;

  // Hover: snap to the nearest point.
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip");
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot");
  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const tAt = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
    const [t, v] = points.reduce((a, b) => (Math.abs(b[0] - tAt) < Math.abs(a[0] - tAt) ? b : a));
    cross.setAttribute("x1", x(t)); cross.setAttribute("x2", x(t)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(t)); dot.setAttribute("cy", y(v)); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(format(v))}</b><span>${new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>`;
    const left = (x(t) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 60), box.width - 60)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  const hit = svg.querySelector(".hit");
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);
}

// Round the top of the axis to a friendly number (1, 2, 5 × 10ⁿ).
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function timeLabel(t, span) {
  const d = new Date(t);
  return span > 2 * 86400000 ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Uptime strip: one block per slice. Text labels carry the meaning, color supports it.
export function uptimeStrip(el, u) {
  const label = (v) => (v === null ? "no data" : v >= 99.9 ? "up" : v > 0 ? `${v}% up` : "down");
  el.innerHTML = `
    <div class="strip">${u.blocks.map((v, i) => {
      const from = new Date(u.since + i * u.sliceMs);
      const cls = v === null ? "none" : v >= 99.9 ? "up" : v > 0 ? "part" : "down";
      return `<i class="${cls}" title="${from.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}: ${label(v)}"></i>`;
    }).join("")}</div>`;
}
