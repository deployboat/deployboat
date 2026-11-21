// Apps list: search, filter by status, sort, group, and drag to reorder (in Custom order).
// Statuses refresh every 5 seconds without losing what you're doing.
import { api, esc, timeAgo, statusOf, icon, toast, copy } from "../app.js";
import { openMenu, pickOne, isMenuOpen } from "../menu.js";
import { openNewApp } from "./new-app.js";

const SORTS = {
  newest: ["Newest first", (a, b) => cmpDate(b.createdAt, a.createdAt)],
  oldest: ["Oldest first", (a, b) => cmpDate(a.createdAt, b.createdAt)],
  name: ["Name", (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })],
  deploy: ["Last deploy", (a, b) => cmpDate(b.lastDeploy?.created_at, a.lastDeploy?.created_at)],
  custom: ["Custom order", (a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || cmpDate(b.createdAt, a.createdAt)],
};
const GROUPS = { none: "None", group: "Your groups", status: "Status" };
const STATUSES = { all: "All", live: "Live", failed: "Failed", building: "Building", stopped: "Stopped" };
const SERVICES = { database: ["db", "Database"], storage: ["folder", "Storage"] };
const cmpDate = (a, b) => (a ?? "").localeCompare(b ?? "");
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Remembered per browser. Storage can be blocked: then we just use the defaults.
const PREFS = "deployboat.apps";
const DEFAULTS = { sort: "newest", groupBy: "none", collapsed: [] };
const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") }; } catch { return { ...DEFAULTS }; } };
const save = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* fine */ } };

export async function appsScreen(view) {
  const prefs = load();
  let apps = [], search = "", status = "all", timer, dragging = false;

  view.innerHTML = `
    <div class="row spread head">
      <div><h1>Apps</h1><p class="muted" id="summary"></p></div>
      <button class="btn primary" id="new">${icon("plus")} New app</button>
    </div>
    <div class="toolbar" id="toolbar">
      <div class="search">${icon("search")}<input id="search" placeholder="Search apps" autocomplete="off"></div>
      <div class="chips" id="chips"></div>
      <span class="grow"></span>
      <button class="btn select" id="sort"></button>
      <button class="btn select" id="groupBy"></button>
    </div>
    <div id="list"></div>`;

  view.querySelector("#new").onclick = openNewApp;
  view.querySelector("#search").oninput = (e) => { search = e.target.value.toLowerCase().trim(); render(); };
  view.querySelector("#sort").onclick = (e) => pickOne(e.currentTarget, Object.entries(SORTS).map(([k, [l]]) => [k, l]), prefs.sort,
    (v) => { prefs.sort = v; save(prefs); render(); }, { title: "Sort by" });
  view.querySelector("#groupBy").onclick = (e) => pickOne(e.currentTarget, Object.entries(GROUPS), prefs.groupBy,
    (v) => { prefs.groupBy = v; save(prefs); render(); }, { title: "Group by" });
  view.querySelector("#chips").onclick = (e) => {
    const b = e.target.closest("[data-status]");
    if (b) { status = b.dataset.status; render(); }
  };

  async function refresh() {
    apps = await api("/api/apps");
    if (!dragging && !isMenuOpen()) render(); // don't redraw under the user's hands
  }

  function render() {
    const list = view.querySelector("#list");
    const main = apps.filter((a) => !a.previewOf);
    drawToolbar(main);
    if (!main.length) { list.innerHTML = empty(); list.querySelector("#new2").onclick = openNewApp; return; }

    const shown = main
      .filter((a) => status === "all" || statusOf(a) === status)
      .filter((a) => !search || `${a.displayName} ${a.name} ${a.url} ${a.group ?? ""}`.toLowerCase().includes(search))
      .sort(SORTS[prefs.sort][1]);

    if (!shown.length) {
      list.innerHTML = `<div class="card pad muted nomatch">No apps match${search ? ` “${esc(search)}”` : ""}${status !== "all" ? ` with status ${STATUSES[status].toLowerCase()}` : ""}.
        <button class="linkbtn" id="clear">Show all apps</button></div>`;
      list.querySelector("#clear").onclick = () => { search = ""; status = "all"; view.querySelector("#search").value = ""; render(); };
      return;
    }

    // Groups: by the user's own groups, or by status. "No group" goes last.
    const keyOf = (a) => (prefs.groupBy === "group" ? a.group || "" : prefs.groupBy === "status" ? statusOf(a) : "");
    const groups = new Map();
    for (const a of shown) { const k = keyOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    const keys = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));

    list.innerHTML = keys.map((k) => {
      const items = groups.get(k);
      const title = prefs.groupBy === "none" ? "" : k ? (prefs.groupBy === "status" ? cap(k) : k) : "No group";
      const closed = prefs.collapsed.includes(`${prefs.groupBy}:${k}`);
      return `
        <div class="group">
          ${title ? `<button class="grouphead" data-toggle="${esc(k)}"><span class="chev ${closed ? "" : "open"}">${icon("chevron")}</span>
            ${prefs.groupBy === "status" ? `<span class="status ${esc(k)}">${esc(title)}</span>` : `<b>${esc(title)}</b>`}<span class="count">${items.length}</span></button>` : ""}
          ${closed ? "" : `<div class="card applist">${items.map(row).join("")}</div>`}
        </div>`;
    }).join("");

    list.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = () => {
      const id = `${prefs.groupBy}:${b.dataset.toggle}`;
      prefs.collapsed = prefs.collapsed.includes(id) ? prefs.collapsed.filter((x) => x !== id) : [...prefs.collapsed, id];
      save(prefs); render();
    }));
    list.querySelectorAll("[data-menu]").forEach((b) => (b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation(); // the row is a link: don't open the app
      rowMenu(b, apps.find((a) => a.name === b.dataset.menu));
    }));
    if (prefs.sort === "custom" && !search && status === "all") dragAndDrop(list);
  }

  // Summary line, status chips with counts, and the two dropdown buttons.
  function drawToolbar(main) {
    const count = (s) => main.filter((a) => statusOf(a) === s).length;
    const problems = count("failed");
    view.querySelector("#summary").innerHTML = !main.length ? "" :
      `${main.length} ${main.length === 1 ? "app" : "apps"} · ${count("live")} live${problems ? ` · <span class="bad">${problems} failed</span>` : ""}`;
    view.querySelector("#toolbar").hidden = !main.length;
    // Only show chips for statuses that exist (plus "All").
    view.querySelector("#chips").innerHTML = Object.entries(STATUSES)
      .filter(([k]) => k === "all" || count(k) || k === status)
      .map(([k, l]) => `<button data-status="${k}" class="${k === status ? "on" : ""}">${k === "all" ? "" : `<span class="status ${k}"></span>`}${l}
        <span class="count">${k === "all" ? main.length : count(k)}</span></button>`).join("");
    view.querySelector("#sort").innerHTML = `<span class="muted">Sort:</span> ${SORTS[prefs.sort][0]} ${icon("down")}`;
    view.querySelector("#groupBy").innerHTML = `<span class="muted">Group:</span> ${GROUPS[prefs.groupBy]} ${icon("down")}`;
  }

  function row(a) {
    const s = statusOf(a), custom = prefs.sort === "custom" && !search && status === "all";
    return `
      <a class="approw" href="#/apps/${encodeURIComponent(a.name)}" data-name="${esc(a.name)}" ${custom ? 'draggable="true"' : ""}>
        ${custom ? `<span class="handle" title="Drag to reorder">⋮⋮</span>` : ""}
        <span class="avatar">${esc(a.displayName.trim()[0] ?? "?").toUpperCase()}</span>
        <span class="grow">
          <span class="name"><b>${esc(a.displayName)}</b>${a.previews ? `<span class="badge">${a.previews} preview${a.previews === 1 ? "" : "s"}</span>` : ""}
            ${a.group && prefs.groupBy !== "group" ? `<span class="tag">${esc(a.group)}</span>` : ""}</span>
          <span class="sub">${esc(a.url.replace("https://", ""))}</span>
        </span>
        <span class="svc">${a.services.map((x) => `<span title="${SERVICES[x]?.[1] ?? x}">${icon(SERVICES[x]?.[0] ?? "box")}</span>`).join("")}</span>
        <span class="status ${s}">${cap(s)}</span>
        <span class="muted when" title="Last deploy">${a.lastDeploy ? timeAgo(a.lastDeploy.created_at) : "never"}</span>
        <button class="btn more" data-menu="${esc(a.name)}" title="More">${icon("dots")}</button>
      </a>`;
  }

  // The "⋯" menu on a row: open, copy address, move to a group.
  function rowMenu(btn, app) {
    openMenu(btn, (menu, close) => {
      const groups = [...new Set(apps.map((a) => a.group).filter(Boolean))].sort();
      menu.innerHTML = `
        <a href="${esc(app.url)}" target="_blank">${icon("external")}<span class="grow">Open site</span></a>
        <button data-copy>${icon("copy")}<span class="grow">Copy address</span></button>
        <hr>
        <div class="dd-title">Move to group</div>
        ${groups.map((g) => `<button data-g="${esc(g)}" class="${g === app.group ? "on" : ""}">${icon("folder")}<span class="grow">${esc(g)}</span>
          <span class="dd-check">${g === app.group ? "✓" : ""}</span></button>`).join("")}
        <form class="dd-new"><input name="g" placeholder="New group name" maxlength="40" autocomplete="off"><button class="btn" title="Add">${icon("plus")}</button></form>
        ${app.group ? `<hr><button data-g="">${icon("trash")}<span class="grow">Remove from group</span></button>` : ""}`;

      menu.querySelector("[data-copy]").onclick = () => { copy(app.url); close(); };
      menu.querySelector("a").onclick = () => close();
      const setGroup = async (g) => {
        close();
        try {
          await api(`/api/apps/${encodeURIComponent(app.name)}/group`, { method: "PUT", body: { group: g } });
          app.group = g || null;
          toast(g ? `Moved to ${g}` : "Removed from group");
        } catch (err) { toast(err.message); }
        render();
      };
      menu.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => setGroup(b.dataset.g)));
      menu.querySelector(".dd-new").onsubmit = (e) => { e.preventDefault(); const g = e.target.g.value.trim(); if (g) setGroup(g); };
    }, { align: "right" });
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
