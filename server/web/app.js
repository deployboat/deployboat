// Dashboard entry: a tiny router plus helpers every screen uses.
import { loginScreen } from "./screens/login.js";
import { appsScreen } from "./screens/apps.js";
import { appScreen } from "./screens/app.js";
import { settingsScreen } from "./screens/settings.js";

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
  if (a.state === "running") return "live";
  return "failed";
}

// Line icons. Usage: icon("copy")
const paths = {
  plus: "M12 5v14M5 12h14",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
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
};
export const icon = (n) => `<svg class="i" viewBox="0 0 24 24"><path d="${paths[n]}"/></svg>`;

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Couldn't copy"); }
}

// --- router --------------------------------------------------------------

let cleanup = () => {};

function showLogin() {
  cleanup(); cleanup = () => {};
  document.getElementById("top").hidden = true;
  loginScreen(view, () => { location.hash = "#/"; render(); });
}

async function render() {
  cleanup(); cleanup = () => {};
  document.getElementById("top").hidden = false;
  const hash = location.hash.slice(1) || "/";
  const [, page, name, tab] = hash.split("/");

  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("on", a.dataset.nav === (page === "settings" ? "settings" : "apps")));

  try {
    if (page === "settings") await settingsScreen(view);
    else if (page === "apps" && name) cleanup = (await appScreen(view, decodeURIComponent(name), tab || "overview")) ?? (() => {});
    else cleanup = (await appsScreen(view)) ?? (() => {});
  } catch (e) {
    if (e.message !== "Logged out") view.innerHTML = `<div class="card pad">${esc(e.message)}</div>`;
  }
}

document.getElementById("logout").onclick = async () => { await api("/auth/logout", { method: "POST" }); showLogin(); };
window.addEventListener("hashchange", render);
render();
