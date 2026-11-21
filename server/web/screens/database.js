// App → Database.
//
// No database yet: pick a type (PostgreSQL, MySQL or SQLite), with what each is good for.
// With one: a viewer (tables on the left; rows, structure or a SQL box on the right),
// how to connect, and deleting it. The server side is services/database.
import { api, esc, icon, toast, bytes } from "../app.js";
import { ask } from "../dialog.js";
import { field, wireFields, removeServiceBox } from "./app.js";
import { codeEditor } from "../editor.js";

const TYPES = {
  postgres: {
    label: "PostgreSQL", tag: "Recommended",
    text: "Powerful and reliable. Works with every framework and ORM: Prisma, Drizzle, Django, Rails, Laravel…",
    gets: "DATABASE_URL",
  },
  mysql: {
    label: "MySQL", tag: "MariaDB",
    text: "Pick it if your app or framework expects MySQL, like WordPress and many PHP apps.",
    gets: "DATABASE_URL (mysql://…)",
  },
  sqlite: {
    label: "SQLite", tag: "No server",
    text: "Just a file in /data. The simplest and very fast, great for small apps that run as one copy.",
    gets: "DATABASE_URL (file:/data/app.db) and SQLITE_PATH",
  },
};

export async function databasePage(box, base, app) {
  if (!app.services.includes("database")) return chooser(box, base);
  const d = await api(`${base}/database`);
  const t = TYPES[d.type];
  const rows = d.tables.reduce((n, x) => n + (x.rows ?? 0), 0);

  box.innerHTML = `
    <div class="stats">
      <div class="card stat"><b>${esc(t.label)}</b><span>${d.type === "mysql" ? "MariaDB" : d.type === "sqlite" ? "file in /data" : "database"}</span></div>
      <div class="card stat"><b>${d.tables.length}</b><span>${d.tables.length === 1 ? "table" : "tables"}</span></div>
      <div class="card stat"><b>${rows.toLocaleString()}</b><span>rows${d.type === "sqlite" ? "" : " (about)"}</span></div>
      <div class="card stat"><b>${d.size ? bytes(d.size) : "—"}</b><span>size</span></div>
    </div>
    ${d.error ? `<div class="card pad banner bad">${icon("alert")}<span class="grow">${esc(d.error)}</span></div>` : ""}

    <div class="card dbview">
      <aside class="dbside">
        <button class="dbitem sql" data-view="sql">${icon("term")} Run SQL</button>
        <div class="fb-filter dbfilter">${icon("search")}<input id="tfilter" placeholder="Filter tables" autocomplete="off"></div>
        <div id="tlist" class="dbtables"></div>
      </aside>
      <section class="dbmain" id="main"></section>
    </div>

    <div class="card pad" style="margin-top:14px">
      <div class="row spread"><b>Connect from your app</b></div>
      <p class="muted" style="font-size:13px;margin:4px 0 12px">Your app already has <code>${esc(t.gets.split(" ")[0])}</code>${d.type === "sqlite" ? " and <code>SQLITE_PATH</code>" : ""}. Nothing to paste.
        ${d.type === "sqlite" ? "" : "The database is only reachable from this app, not from the internet."}</p>
      <dl class="info">${field("DATABASE_URL", d.url, { secret: d.type !== "sqlite" })}</dl>
      <pre class="log" style="max-height:none;margin-top:12px">${esc(SNIPPETS[d.type])}</pre>
    </div>`;
  wireFields(box);
  removeServiceBox(box, base, app, "database");

  // --- the viewer ----------------------------------------------------------------
  const main = box.querySelector("#main");
  let current = null; // the open table, or null for the SQL box

  function drawTables() {
    const q = box.querySelector("#tfilter").value.toLowerCase();
    const list = d.tables.filter((x) => x.name.toLowerCase().includes(q));
    box.querySelector("#tlist").innerHTML = list.map((x) => `
      <button class="dbitem ${current === x.name ? "on" : ""}" data-table="${esc(x.name)}">
        ${icon("list")}<span class="grow">${esc(x.name)}</span><span class="dbcount">${x.rows === null ? "" : x.rows.toLocaleString()}</span></button>`).join("")
      || `<p class="note dbnone">${d.tables.length ? "No table matches." : "No tables yet. Your app creates them (usually with migrations), or use Run SQL."}</p>`;
    box.querySelectorAll("[data-table]").forEach((b) => (b.onclick = () => openTable(b.dataset.table)));
    box.querySelector('[data-view="sql"]').classList.toggle("on", current === null);
  }
  box.querySelector("#tfilter").oninput = drawTables;
  box.querySelector('[data-view="sql"]').onclick = () => openSql();

  // A table: its rows (a page at a time) or its structure.
  async function openTable(name, page = 0, tab = "data") {
    current = name; drawTables();
    main.innerHTML = `<div class="dbhead"><b>${esc(name)}</b>
      <div class="chips"><button data-tab="data" class="${tab === "data" ? "on" : ""}">Data</button><button data-tab="structure" class="${tab === "structure" ? "on" : ""}">Structure</button></div></div>
      <div class="fb-loading"><span class="spinner"></span></div>`;
    let r;
    try { r = await api(`${base}/database/tables/${encodeURIComponent(name)}?page=${page}`); }
    catch (err) { main.querySelector(".fb-loading").innerHTML = esc(err.message); return; }
    if (current !== name) return; // clicked another table meanwhile
    const total = d.tables.find((x) => x.name === name)?.rows ?? null;
    const last = r.rows.rows.length < r.limit;
    main.querySelector(".fb-loading").outerHTML = tab === "data" ? `
      ${grid(r.rows)}
      <div class="dbfoot">
        <span class="note">Rows ${(page * r.limit + 1).toLocaleString()}–${(page * r.limit + r.rows.rows.length).toLocaleString()}${total !== null ? ` of ${d.type === "sqlite" ? "" : "about "}${total.toLocaleString()}` : ""}</span>
        <span class="row" style="gap:6px"><button class="btn" id="prev" ${page ? "" : "disabled"}>${icon("back")} Previous</button>
          <button class="btn" id="next" ${last ? "disabled" : ""}>Next ${icon("chevron")}</button></span>
      </div>` : structure(r.columns);
    main.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => openTable(name, 0, b.dataset.tab)));
    main.querySelector("#prev")?.addEventListener("click", () => openTable(name, page - 1));
    main.querySelector("#next")?.addEventListener("click", () => openTable(name, page + 1));
  }

  // The SQL box. Ctrl/Cmd+Enter runs it. Anything that isn't a read asks first.
  async function openSql(text = current ? `SELECT * FROM ${quoteName(current, d.type)} LIMIT 50;` : "") {
    current = null; drawTables();
    main.innerHTML = `
      <div class="dbhead"><b>Run SQL</b><span class="note">Runs as this app's database user · ${esc(t.label)}</span></div>
      <div class="dbsql"><div class="fb-code" id="sqlbox"></div></div>
      <div class="dbrun"><span class="note">Ctrl + Enter to run. One statement at a time works best.</span>
        <button class="btn primary" id="run">${icon("play")} Run</button></div>
      <div id="result"></div>`;
    const cm = await codeEditor(main.querySelector("#sqlbox"), text || "SELECT 1;", "query.sql");
    if (!main.contains(cm.getWrapperElement())) return;
    cm.focus(); cm.setCursor(cm.lineCount(), 0);
    const run = async () => {
      const sql = cm.getSelection() || cm.getValue();
      if (!isReadOnly(sql) && !(await ask({ title: "Run this change?", text: `It can change or delete data in ${app.displayName}'s database:\n\n${sql.trim().slice(0, 300)}`, ok: "Run it", danger: true }))) return;
      const out = main.querySelector("#result"), b = main.querySelector("#run");
      b.disabled = true; out.innerHTML = `<div class="fb-loading"><span class="spinner"></span></div>`;
      try {
        const r = await api(`${base}/database/query`, { method: "POST", body: { sql } });
        out.innerHTML = r.columns.length
          ? `${grid(r)}<div class="dbfoot"><span class="note">${r.rows.length.toLocaleString()} row${r.rows.length === 1 ? "" : "s"}${r.truncated ? " (only the first ones are shown)" : ""} · ${r.ms} ms</span>
              <button class="btn ghost" id="csv">${icon("download")} CSV</button></div>`
          : `<div class="dbmsg ok">${icon("check")} ${esc(r.message || "Done.")} <span class="note">${r.ms} ms</span></div>`;
        out.querySelector("#csv")?.addEventListener("click", () => saveCsv(r));
        if (!isReadOnly(sql)) refreshTables(); // a table may be new or gone
      } catch (err) {
        out.innerHTML = `<div class="dbmsg bad">${icon("alert")}<pre>${esc(err.message)}</pre></div>`;
      }
      b.disabled = false;
    };
    main.querySelector("#run").onclick = run;
    cm.setOption("extraKeys", { ...cm.getOption("extraKeys"), "Ctrl-Enter": run, "Cmd-Enter": run });
  }

  async function refreshTables() {
    const fresh = await api(`${base}/database`).catch(() => null);
    if (fresh && box.isConnected) { d.tables = fresh.tables; drawTables(); }
  }

  drawTables();
  if (d.tables.length) openTable(d.tables[0].name); else openSql();
}

// --- pieces ----------------------------------------------------------------------

// A result as a table. NULL looks different from an empty text.
function grid(r) {
  if (!r.rows.length) return `<div class="dbmsg">No rows.</div>`;
  return `<div class="dbgrid"><table>
    <thead><tr><th class="rn">#</th>${r.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${r.rows.map((row, i) => `<tr><td class="rn">${i + 1}</td>${row.map((v) => v === null
      ? `<td class="null">NULL</td>`
      : `<td title="${esc(String(v).slice(0, 500))}">${esc(String(v).slice(0, 200))}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function structure(cols) {
  return `<div class="dbgrid"><table>
    <thead><tr><th>Column</th><th>Type</th><th>Can be empty</th><th>Default</th></tr></thead>
    <tbody>${cols.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.key ? ` <span class="badge">key</span>` : ""}</td>
      <td><code>${esc(c.type)}</code></td><td>${c.nullable ? "yes" : "no"}</td>
      <td>${c.default === null ? `<span class="muted">—</span>` : `<code>${esc(c.default)}</code>`}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

const quoteName = (name, type) => type === "mysql" ? "`" + name + "`"
  : name.split(".").map((p) => (/^[a-z_][a-z0-9_]*$/.test(p) ? p : `"${p}"`)).join(".");

// Reads only. (The server runs anything; this is just so changes ask first.)
const isReadOnly = (sql) => /^\s*(select|with|show|explain|describe|desc|pragma|values)\b/i
  .test(sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, "")) && !/\b(insert|update|delete|drop|alter|create|truncate)\b/i.test(sql);

function saveCsv(r) {
  const cell = (v) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const text = [r.columns, ...r.rows].map((row) => row.map(cell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = "result.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- no database yet: pick a type ----------------------------------------------------

function chooser(box, base) {
  box.innerHTML = `
    <div class="card pad">
      <b>Add a database</b>
      <p class="muted" style="font-size:13px;margin:2px 0 14px">Pick the kind your app needs. It's created on this server, and your app gets the connection details as variables and restarts.</p>
      <div class="dbtypes">${Object.entries(TYPES).map(([k, t]) => `
        <div class="card dbtype ${k === "postgres" ? "on" : ""}">
          <div class="row spread"><b>${t.label}</b><span class="pill ${k === "postgres" ? "ok" : "plain"}">${t.tag}</span></div>
          <p class="muted">${t.text}</p>
          <p class="note">Your app gets <code>${esc(t.gets)}</code></p>
          <button class="btn ${k === "postgres" ? "primary" : ""}" data-type="${k}">${icon("plus")} Create ${t.label}</button>
        </div>`).join("")}</div>
      <p class="note" style="margin-top:12px">Not sure? Pick PostgreSQL. You can't switch later without deleting the database, so choose what your app's code expects.
        AI agents can add one too: <code>deployboat add database</code>.</p>
    </div>`;
  box.querySelectorAll("[data-type]").forEach((b) => (b.onclick = async () => {
    box.querySelectorAll("[data-type]").forEach((x) => (x.disabled = true));
    b.innerHTML = `<span class="spinner sm"></span> Creating…`;
    try {
      await api(`${base}/services/database`, { method: "POST", body: { type: b.dataset.type } });
      toast(`${TYPES[b.dataset.type].label} database created`);
      dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (err) {
      toast(err.message, "error");
      box.querySelectorAll("[data-type]").forEach((x) => (x.disabled = false));
      b.innerHTML = `${icon("plus")} Create ${TYPES[b.dataset.type].label}`;
    }
  }));
}

// Short connection examples. They only use the variables the app already has.
const SNIPPETS = {
  postgres: `// Node.js: npm install pg
import pg from "pg";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [42]);

// Prisma (schema.prisma): datasource db { provider = "postgresql"  url = env("DATABASE_URL") }
# Python: psycopg.connect(os.environ["DATABASE_URL"])`,
  mysql: `// Node.js: npm install mysql2
import mysql from "mysql2/promise";
const db = mysql.createPool(process.env.DATABASE_URL);
const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [42]);

// Prisma (schema.prisma): datasource db { provider = "mysql"  url = env("DATABASE_URL") }
# PHP / Laravel: DB_URL=\${DATABASE_URL}`,
  sqlite: `// Node.js 22+: built in
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.SQLITE_PATH);
const user = db.prepare("SELECT * FROM users WHERE id = ?").get(42);

// Prisma (schema.prisma): datasource db { provider = "sqlite"  url = env("DATABASE_URL") }
# Python: sqlite3.connect(os.environ["SQLITE_PATH"])`,
};
