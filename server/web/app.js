// Dashboard entry: a tiny router plus helpers every screen uses.
import { loginScreen } from "./screens/login.js";
import { appsScreen } from "./screens/apps.js";
import { appScreen, SECTIONS } from "./screens/app.js";
import { settingsScreen } from "./screens/settings.js";
import { serverScreen } from "./screens/server.js";

const view = document.getElementById("view");

// --- helpers -------------------------------------------------------------

// Escape text before putting it in HTML.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Call the server. Shows the login screen if we're logged out.
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/auth")) { showLogin(); throw new Error("Logged out"); }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t.timer); t.timer = setTimeout(() => (t.hidden = true), 2200);
}

export function bytes(n) {
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function timeAgo(sqlDate) {
  if (!sqlDate) return "never";
  const s = (Date.now() - new Date(sqlDate.replace(" ", "T") + "Z")) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// One status for an app: building, live or failed.
export function statusOf(a) {
  if (a.building) return "building";
  if (a.stopped) return "stopped";
  if (a.state === "running") return "live";
  return "failed";
}

// Line icons. Usage: icon("copy")
const paths = {
  plus: "M12 5v14M5 12h14",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  stop: "M6 6h12v12H6z",
  play: "M7 4l13 8-13 8z",
  restart: "M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  back: "M15 18l-6-6 6-6",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  term: "M4 17l6-5-6-5M12 19h8",
  key: "M15 7a4 4 0 11-4 4M11 11L3 19v2h3l1-1v-2h2v-2h2l1.5-1.5",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4",
  rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3c1-4 5-8 13-9-1 8-5 12-9 13z",
  home: "M3 11l9-8 9 8M5 9v12h14V9",
  history: "M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5M12 7v5l3 2",
  db: "M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18",
  share: "M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  server: "M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01",
  chevron: "M9 6l6 6-6 6",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17v4M17 19h4",
  git: "M6 3.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM6 15.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM18 6.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM6 8.5v7M18 11.5c0 4-6 3-10 5",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
};
export const icon = (n) => `<svg class="i" viewBox="0 0 24 24"><path d="${paths[n]}"/></svg>`;

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Couldn't copy"); }
}

// --- router --------------------------------------------------------------

let cleanup = () => {};

function showLogin() {
  cleanup(); cleanup = () => {}; current++;
  document.getElementById("top").hidden = true;
  loginScreen(view, () => { location.hash = "#/"; render(); });
}

let current = 0;

// Sidebar: main menu, or the app menu when you're inside an app.
function drawNav(page, appName, section) {
  const nav = document.getElementById("nav");
  const link = (href, ic, label, on) => `<a href="${href}" class="${on ? "on" : ""}">${icon(ic)}${label}</a>`;

  if (page === "apps" && appName) {
    const base = `#/apps/${encodeURIComponent(appName)}`;
    nav.innerHTML = `
      <a href="#/" class="back">${icon("back")}All apps</a>
      <div class="navtitle">${esc(appName)}</div>
      ${SECTIONS.map(([id, label, ic, soon]) => soon
        ? `<span class="soon">${icon(ic)}${label}<em>Soon</em></span>`
        : link(`${base}/${id}`, ic, label, id === section)).join("")}`;
  } else {
    nav.innerHTML = `
      ${link("#/", "box", "Apps", !["settings", "server"].includes(page))}
      ${link("#/server", "server", "Server", page === "server")}
      ${link("#/settings", "gear", "Settings", page === "settings")}`;
  }
}

async function render() {
  cleanup(); cleanup = () => {};
  document.getElementById("top").hidden = false;
  const hash = location.hash.slice(1) || "/";
  const [, page, name, tab] = hash.split("/");

  drawNav(page, name && decodeURIComponent(name), tab || "overview");

  // Each page draws into its own box. When you navigate away, the old box is
  // removed, so slow loads or timers from the old page can't overwrite the new one.
  const id = ++current;
  const box = document.createElement("div");
  view.replaceChildren(box);

  // Show a spinner if the page takes more than a moment. The screen replaces it when ready.
  const spinner = setTimeout(() => {
    if (id === current && !box.innerHTML) box.innerHTML = `<div class="loading"><span class="spinner"></span>Loading…</div>`;
  }, 120);

  try {
    let stop;
    if (page === "settings") stop = await settingsScreen(box);
    else if (page === "server") stop = await serverScreen(box);
    else if (page === "apps" && name) stop = await appScreen(box, decodeURIComponent(name), tab || "overview");
    else stop = await appsScreen(box);
    clearTimeout(spinner);
    if (id === current) cleanup = stop ?? (() => {});
    else stop?.(); // we already moved on: stop its timers right away
  } catch (e) {
    clearTimeout(spinner);
    if (id === current && e.message !== "Logged out") box.innerHTML = `<div class="card pad">${esc(e.message)}</div>`;
  }
}

document.getElementById("logout").onclick = async () => { await api("/auth/logout", { method: "POST" }); showLogin(); };
window.addEventListener("hashchange", render);
render();
