// Apps list: sort, group, search, and drag to reorder (in Custom order).
// Statuses refresh every 5 seconds without losing what you're doing.
import { api, esc, timeAgo, statusOf, icon, toast } from "../app.js";
import { openNewApp } from "./new-app.js";

const SORTS = {
  newest: ["Newest first", (a, b) => cmpDate(b.createdAt, a.createdAt)],
  oldest: ["Oldest first", (a, b) => cmpDate(a.createdAt, b.createdAt)],
  name: ["Name", (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })],
  deploy: ["Last deploy", (a, b) => cmpDate(b.lastDeploy?.created_at, a.lastDeploy?.created_at)],
  custom: ["Custom order", (a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || cmpDate(b.createdAt, a.createdAt)],
};
const GROUPS = { none: "No grouping", group: "Group", status: "Status" };
const cmpDate = (a, b) => (a ?? "").localeCompare(b ?? "");

// Remembered per browser. Storage can be blocked: then we just use the defaults.
const PREFS = "deployboat.apps";
const load = () => { try { return { sort: "newest", groupBy: "none", collapsed: [], ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") }; } catch { return { sort: "newest", groupBy: "none", collapsed: [] }; } };
const save = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* fine */ } };

export async function appsScreen(view) {
  const prefs = load();
  let apps = [], search = "", timer, dragging = false;

  view.innerHTML = `
    <div class="row spread head">
      <div class="row"><h1>Apps</h1><span class="muted" id="count"></span></div>
      <button class="btn primary" id="new">${icon("plus")} New app</button>
    </div>
    <div class="toolbar" id="toolbar">
      <input id="search" placeholder="Search…" autocomplete="off">
      <label>Sort <select id="sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === prefs.sort ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Group by <select id="groupBy">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${k === prefs.groupBy ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <div id="list"></div>`;
  view.querySelector("#new").onclick = openNewApp;
  view.querySelector("#search").oninput = (e) => { search = e.target.value.toLowerCase(); render(); };
  view.querySelector("#sort").onchange = (e) => { prefs.sort = e.target.value; save(prefs); render(); };
  view.querySelector("#groupBy").onchange = (e) => { prefs.groupBy = e.target.value; save(prefs); render(); };

  async function refresh() {
    apps = await api("/api/apps");
    if (!dragging && !view.querySelector(".menu")) render(); // don't redraw under the user's hands
  }

  function render() {
    const list = view.querySelector("#list");
    const main = apps.filter((a) => !a.previewOf);
    view.querySelector("#count").textContent = main.length;
    view.querySelector("#toolbar").hidden = !main.length;
    if (!main.length) { list.innerHTML = empty(); list.querySelector("#new2").onclick = openNewApp; return; }

    const shown = main
      .filter((a) => !search || `${a.displayName} ${a.name} ${a.url}`.toLowerCase().includes(search))
      .sort(SORTS[prefs.sort][1]);

    // Groups: by the user's own groups, or by status. "No group" goes last.
    const keyOf = (a) => (prefs.groupBy === "group" ? a.group || "" : prefs.groupBy === "status" ? statusOf(a) : "");
    const groups = new Map();
    for (const a of shown) { const k = keyOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    const keys = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));

    list.innerHTML = shown.length ? keys.map((k) => {
      const items = groups.get(k);
      const title = prefs.groupBy === "none" ? "" : k || (prefs.groupBy === "group" ? "No group" : "");
      const closed = prefs.collapsed.includes(`${prefs.groupBy}:${k}`);
      return `
        <div class="group" data-group="${esc(k)}">
          ${title ? `<button class="grouphead" data-toggle="${esc(k)}"><span class="chev ${closed ? "" : "open"}">${icon("chevron")}</span>
            ${prefs.groupBy === "status" ? `<span class="status ${esc(k)}">${esc(k)}</span>` : `<b>${esc(title)}</b>`}<span class="muted">${items.length}</span></button>` : ""}
          ${closed ? "" : `<div class="card applist">${items.map(row).join("")}</div>`}
        </div>`;
    }).join("") : `<div class="card pad muted">No apps match “${esc(search)}”.</div>`;

    list.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = () => {
      const id = `${prefs.groupBy}:${b.dataset.toggle}`;
      prefs.collapsed = prefs.collapsed.includes(id) ? prefs.collapsed.filter((x) => x !== id) : [...prefs.collapsed, id];
      save(prefs); render();
    }));
    list.querySelectorAll("[data-menu]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); menu(b, apps.find((a) => a.name === b.dataset.menu)); }));
    if (prefs.sort === "custom" && !search) dragAndDrop(list);
  }

  function row(a) {
    const s = statusOf(a), custom = prefs.sort === "custom" && !search;
    return `
      <a class="approw" href="#/apps/${encodeURIComponent(a.name)}" data-name="${esc(a.name)}" ${custom ? 'draggable="true"' : ""}>
        ${custom ? `<span class="handle" title="Drag to reorder">⋮⋮</span>` : ""}
        <span class="grow">
          <b>${esc(a.displayName)}</b>${a.previews ? ` <span class="badge">${a.previews} preview${a.previews === 1 ? "" : "s"}</span>` : ""}
          <span class="sub">${esc(a.url.replace("https://", ""))}</span>
        </span>
        <span class="svc">${a.services.map((x) => `<span title="${x}">${icon({ database: "db", storage: "folder", email: "mail" }[x])}</span>`).join("")}</span>
        <span class="status ${s}">${s}</span>
        <span class="muted when" title="Last deploy">${timeAgo(a.lastDeploy?.created_at)}</span>
        <button class="btn more" data-menu="${esc(a.name)}" title="More">⋯</button>
      </a>`;
  }

  // Row menu: move to a group.
  function menu(btn, app) {
    view.querySelector(".menu")?.remove();
    const existing = [...new Set(apps.map((a) => a.group).filter(Boolean))].sort();
    const m = document.createElement("div");
    m.className = "menu card";
    m.innerHTML = `
      <div class="note" style="padding:6px 10px">Move to group</div>
      ${existing.map((g) => `<button data-g="${esc(g)}" class="${g === app.group ? "on" : ""}">${esc(g)}</button>`).join("")}
      <button data-new>${icon("plus")} New group…</button>
      ${app.group ? `<button data-g="">Remove from group</button>` : ""}`;
    btn.closest(".approw").after(m);
    const close = () => { m.remove(); document.removeEventListener("click", outside); render(); };
    const outside = (e) => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("click", outside));
    const setGroup = async (g) => {
      try { await api(`/api/apps/${encodeURIComponent(app.name)}/group`, { method: "PUT", body: { group: g } }); app.group = g || null; toast(g ? `Moved to ${g}` : "Removed from group"); }
      catch (err) { toast(err.message); }
      close();
    };
    m.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => setGroup(b.dataset.g)));
    m.querySelector("[data-new]").onclick = () => { const g = prompt("Group name (e.g. Clients, Side projects):"); if (g?.trim()) setGroup(g.trim()); else close(); };
  }

  // Custom order: drag rows; saved for every browser.
  function dragAndDrop(list) {
    let moving = null;
    list.querySelectorAll(".approw[draggable]").forEach((r) => {
      r.addEventListener("dragstart", (e) => { moving = r; dragging = true; r.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      r.addEventListener("dragend", async () => {
        r.classList.remove("dragging"); dragging = false;
        // Every app's position: shown rows first (in their new order), then any hidden ones.
        const order = [...list.querySelectorAll(".approw")].map((x) => x.dataset.name);
        const rest = apps.filter((a) => !order.includes(a.name)).sort(SORTS.custom[1]).map((a) => a.name);
        const names = [...order, ...rest];
        names.forEach((n, i) => { const a = apps.find((x) => x.name === n); if (a) a.sortOrder = i; });
        try { await api("/api/apps/order", { method: "PUT", body: { names } }); } catch (err) { toast(err.message); }
        render();
      });
      r.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!moving || moving === r || moving.parentNode !== r.parentNode) return; // stay inside its group
        const after = e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2;
        r.parentNode.insertBefore(moving, after ? r.nextSibling : r);
      });
    });
  }

  await refresh();
  render();
  timer = setInterval(() => refresh().catch(() => {}), 5000);
  return () => clearInterval(timer);
}

const empty = () => `
  <div class="card empty">
    ${icon("rocket")}
    <h2>No apps yet</h2>
    <p class="muted" style="margin-bottom:16px">Publish from your computer, your AI agent, or a Git repo.</p>
    <button class="btn primary" id="new2">${icon("plus")} New app</button>
  </div>`;
