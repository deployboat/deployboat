// Apps list. Refreshes every 5 seconds so statuses stay current.
import { api, esc, timeAgo, statusOf, icon } from "../app.js";

export async function appsScreen(view) {
  async function draw() {
    const apps = await api("/api/apps");
    view.innerHTML = `
      <div class="row spread head"><h1>Apps</h1><span class="muted">${apps.length} app${apps.length === 1 ? "" : "s"}</span></div>
      ${apps.length ? `<div class="apps">${apps.map(card).join("")}</div>` : empty()}`;
  }
  await draw();
  const timer = setInterval(() => draw().catch(() => {}), 5000);
  return () => clearInterval(timer);
}

function card(a) {
  const s = statusOf(a);
  return `
    <a class="card app" href="#/apps/${encodeURIComponent(a.name)}">
      <b>${esc(a.name)}</b>
      <div class="url">${esc(a.url.replace("https://", ""))}</div>
      <div class="row spread"><span class="status ${s}">${s}</span><span class="muted">${timeAgo(a.lastDeploy?.created_at)}</span></div>
    </a>`;
}

const empty = () => `
  <div class="card empty">
    ${icon("rocket")}
    <h2>No apps yet</h2>
    <p class="muted">Run this in any project folder to publish it:</p>
    <pre>npx deployboat deploy</pre>
  </div>`;
