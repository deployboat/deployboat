// Apps list. Refreshes every 5 seconds so statuses stay current.
import { api, esc, timeAgo, statusOf, icon } from "../app.js";
import { openNewApp } from "./new-app.js";

export async function appsScreen(view) {
  async function draw() {
    const apps = await api("/api/apps");
    view.innerHTML = `
      <div class="row spread head">
        <div class="row"><h1>Apps</h1><span class="muted">${apps.length}</span></div>
        <button class="btn primary" id="new">${icon("plus")} New app</button>
      </div>
      ${apps.length ? `<div class="apps">${apps.map(card).join("")}</div>` : empty()}`;
    view.querySelectorAll("#new, #new2").forEach((b) => (b.onclick = openNewApp));
  }
  await draw();
  const timer = setInterval(() => draw().catch(() => {}), 5000);
  return () => clearInterval(timer);
}

function card(a) {
  const s = statusOf(a);
  return `
    <a class="card app" href="#/apps/${encodeURIComponent(a.name)}">
      <b>${esc(a.displayName)}</b>
      <div class="url">${esc(a.url.replace("https://", ""))}</div>
      <div class="row spread"><span class="status ${s}">${s}</span><span class="muted">${timeAgo(a.lastDeploy?.created_at)}</span></div>
    </a>`;
}

const empty = () => `
  <div class="card empty">
    ${icon("rocket")}
    <h2>No apps yet</h2>
    <p class="muted" style="margin-bottom:16px">Publish from your computer, your AI agent, or a Git repo.</p>
    <button class="btn primary" id="new2">${icon("plus")} New app</button>
  </div>`;
