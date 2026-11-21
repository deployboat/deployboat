// App → Files: a file browser for everything inside the app, with a code editor.
//
// Left: the folder you're in. Right: the open file, in CodeMirror (see ../editor.js).
// While the app runs you see its whole container. When it's stopped, only the
// persistent folders (the server decides, see api/files.ts).
//
// Moving between folders doesn't reload the page, so an open file stays open.
// The folder is kept in the address (?path=), so a refresh comes back to it.
import { api, esc, icon, toast, bytes, timeAgo, copy } from "../app.js";
import { ask, askText } from "../dialog.js";
import { openMenu } from "../menu.js";
import { codeEditor } from "../editor.js";

export async function filesPage(box, base, app) {
  const startPath = new URLSearchParams(location.hash.split("?")[1] ?? "").get("path") ?? "";
  box.innerHTML = loading("Opening files…"); // the first load reaches into the container and can take a moment
  let d = await api(`${base}/files?path=${encodeURIComponent(startPath)}`);

  // The open file: { path, cm (the editor), saved (text when last saved) }.
  let open = null;
  const dirty = () => open?.cm && open.cm.getValue() !== open.saved;

  const isKept = (p) => d.folders.some((f) => p === f || p.startsWith(`${f}/`));
  const join = (name) => (d.path === "/" ? "" : d.path) + "/" + name;
  const parentOf = (p) => p.replace(/\/[^/]+$/, "") || "/";

  box.innerHTML = `
    ${d.why ? `<div class="card pad banner">${icon("info")}<span class="grow">${esc(d.why)}</span></div>` : ""}
    <div class="fb">
      <div class="card fb-side">
        <div class="fb-head">
          <div class="fb-places" id="places"></div>
          <div class="row" style="gap:6px;flex-wrap:nowrap">
            <div class="fb-filter">${icon("search")}<input id="filter" placeholder="Filter" autocomplete="off"></div>
            <button class="btn" id="newfile" title="New file">${icon("file")}</button>
            <button class="btn" id="newdir" title="New folder">${icon("folder")}</button>
            <label class="btn" title="Upload">${icon("upload")}<input type="file" multiple hidden id="up"></label>
          </div>
          <div class="fb-crumbs" id="crumbs"></div>
        </div>
        <div class="fb-list" id="list"></div>
        <div class="fb-drop" id="drop">${icon("upload")} Drop to upload here</div>
      </div>
      <div class="card fb-editor" id="editor"></div>
    </div>`;
  const list = box.querySelector("#list");
  const editor = box.querySelector("#editor");

  // --- the folder side --------------------------------------------------

  function drawPlaces() {
    // Quick jumps: where the app starts, its persistent folders, and the very top.
    const places = [...new Set([d.home, ...d.folders, ...(d.live ? ["/"] : [])])];
    box.querySelector("#places").innerHTML = places.map((p) => `
      <button data-place="${esc(p)}" class="${p === d.path ? "on" : ""}" title="${isKept(p) ? "Kept across deploys" : ""}">
        ${icon(p === d.home ? "home" : isKept(p) ? "disk" : "folder")}${esc(p)}</button>`).join("");
    box.querySelectorAll("[data-place]").forEach((b) => (b.onclick = () => go(b.dataset.place)));
  }

  function drawCrumbs() {
    // "/app/src/lib" → clickable /, app, src, lib. Click the empty space to type a path.
    const parts = d.path.split("/").filter(Boolean);
    const el = box.querySelector("#crumbs");
    el.innerHTML = `
      <a data-go="/">/</a>${parts.map((p, i) => `<a data-go="${esc("/" + parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`).join("<span>/</span>")}
      <span class="grow" id="typepath" title="Type a path"></span>
      ${isKept(d.path) ? `<span class="pill ok" title="Files here survive deploys">kept</span>`
        : `<span class="pill warn" title="Only the persistent folders survive a deploy">reset on deploy</span>`}`;
    el.querySelectorAll("[data-go]").forEach((a) => (a.onclick = () => go(a.dataset.go)));
    el.querySelector("#typepath").onclick = () => {
      el.innerHTML = `<form style="flex:1"><input name="p" value="${esc(d.path)}" spellcheck="false"></form>`;
      const f = el.querySelector("form");
      f.p.focus(); f.p.select();
      f.onsubmit = (e) => { e.preventDefault(); go(f.p.value.trim() || "/"); };
      f.p.onblur = () => drawCrumbs();
      f.p.onkeydown = (e) => { if (e.key === "Escape") drawCrumbs(); };
    };
  }

  function drawList() {
    const q = box.querySelector("#filter").value.toLowerCase();
    const rows = d.entries.filter((e) => e.name.toLowerCase().includes(q));
    list.innerHTML = `
      ${d.path !== "/" && !q ? `<div class="fb-row" data-dir="${esc(parentOf(d.path))}">${icon("back")}<span class="grow muted">..</span></div>` : ""}
      ${rows.map((e) => {
        const p = join(e.name);
        return `
        <div class="fb-row ${open?.path === p ? "on" : ""}" ${e.dir ? `data-dir="${esc(p)}"` : `data-file="${esc(p)}"`}>
          ${icon(e.dir ? (isKept(p) ? "disk" : "folder") : "file")}
          <span class="grow fb-name">${esc(e.name)}${e.link ? ` <span class="muted">→</span>` : ""}</span>
          <span class="fb-meta">${e.dir ? "" : bytes(e.size)}</span>
          <button class="btn ghost fb-more" data-more="${esc(p)}" data-isdir="${e.dir}" title="More">${icon("dots")}</button>
        </div>`;
      }).join("")}
      ${rows.length ? "" : `<div class="muted fb-empty">${q ? "Nothing matches." : "This folder is empty."}</div>`}`;
    list.querySelectorAll("[data-dir]").forEach((r) => (r.onclick = () => go(r.dataset.dir)));
    list.querySelectorAll("[data-file]").forEach((r) => (r.onclick = (e) => { if (!e.target.closest("button")) openFile(r.dataset.file); }));
    list.querySelectorAll("[data-more]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); rowMenu(b); }));
  }

  // Open another folder, without leaving the page.
  // Only the newest click counts: a slow earlier answer must not replace a newer one.
  let goId = 0;
  async function go(path) {
    const id = ++goId;
    list.classList.add("busy"); // dims the list and shows a spinner on top (style.css)
    try {
      const next = await api(`${base}/files?path=${encodeURIComponent(path)}`);
      if (id !== goId) return;
      d = next;
    } catch (err) { if (id === goId) toast(err.message, "error"); return; }
    finally { if (id === goId) list.classList.remove("busy"); }
    box.querySelector("#filter").value = "";
    history.replaceState(null, "", `#/apps/${encodeURIComponent(app.name)}/files?path=${encodeURIComponent(d.path)}`);
    drawAll();
  }
  const reload = () => go(d.path);
  const drawAll = () => { drawPlaces(); drawCrumbs(); drawList(); };

  // The "⋯" menu on a row: rename, download, copy path, delete.
  function rowMenu(btn) {
    const path = btn.dataset.more, isDir = btn.dataset.isdir === "true";
    openMenu(btn, (menu, close) => {
      menu.innerHTML = `
        <button data-a="rename">${icon("edit")}<span class="grow">Rename</span></button>
        ${isDir ? "" : `<a href="${base}/files/download?path=${encodeURIComponent(path)}">${icon("download")}<span class="grow">Download</span></a>`}
        <button data-a="copy">${icon("copy")}<span class="grow">Copy path</span></button>
        <hr>
        <button data-a="delete" class="danger">${icon("trash")}<span class="grow">Delete</span></button>`;
      menu.querySelector("a")?.addEventListener("click", close);
      menu.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
        close();
        const action = b.dataset.a;
        if (action === "copy") return copy(path);
        if (action === "rename") {
          const name = await askText({ title: "Rename", label: "New name", value: path.split("/").pop(), ok: "Rename" });
          if (!name || name.includes("/")) return;
          const to = parentOf(path).replace(/\/$/, "") + "/" + name;
          try { await api(`${base}/files/rename`, { method: "POST", body: { from: path, to } }); toast("Renamed"); }
          catch (err) { return toast(err.message, "error"); }
          if (open?.path === path) { open.path = to; drawEditorHead(); }
          return reload();
        }
        if (action === "delete") {
          const what = isDir ? "this folder and everything in it" : "this file";
          if (!(await ask({ title: `Delete ${what}?`, text: `${path}\n\nYour app may need it. This can't be undone.`, ok: "Delete", danger: true }))) return;
          try { await api(`${base}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }); toast("Deleted"); }
          catch (err) { return toast(err.message, "error"); }
          if (open?.path === path) closeFile(true);
          reload();
        }
      }));
    }, { align: "right" });
  }

  // --- the editor side --------------------------------------------------

  function drawEmpty() {
    editor.innerHTML = `<div class="fb-placeholder">${icon("file")}<p>Pick a file to see or edit it.</p>
      <p class="note">${d.live ? "Changes outside the persistent folders are lost on the next deploy. To change your app's code for good, change it in your project and deploy." : ""}</p></div>`;
  }

  function drawEditorHead() {
    const head = editor.querySelector(".fb-edhead");
    if (!head || !open) return;
    head.querySelector(".fb-path").textContent = open.path;
    head.querySelector(".fb-dot").hidden = !dirty();
    const save = head.querySelector("#savefile");
    if (save) save.disabled = !dirty();
  }

  let openId = 0;
  async function openFile(path, text) {
    if (dirty() && !(await ask({ title: "Discard your changes?", text: `${open.path} has unsaved changes.`, ok: "Discard", danger: true }))) return;
    const id = ++openId;
    let reason = null;
    if (text === undefined) {
      // Show where we're going right away, then the file once it's here.
      open = null;
      editor.innerHTML = `<div class="fb-edhead"><code class="fb-path grow">${esc(path)}</code></div>${loading("Loading file…")}`;
      list.querySelectorAll(".fb-row").forEach((r) => r.classList.toggle("on", r.dataset.file === path));
      try { ({ text, reason } = await api(`${base}/files/text?path=${encodeURIComponent(path)}`)); }
      catch (err) { if (id === openId) { toast(err.message, "error"); drawEmpty(); } return; }
      if (id !== openId) return; // another file was clicked meanwhile
    }
    open = { path, cm: null, saved: text };
    editor.innerHTML = `
      <div class="fb-edhead">
        <span class="fb-dot" hidden title="Unsaved changes"></span>
        <code class="fb-path grow"></code>
        ${isKept(path) ? "" : `<span class="pill warn" title="Only the persistent folders survive a deploy">reset on deploy</span>`}
        <a class="btn ghost" title="Download" href="${base}/files/download?path=${encodeURIComponent(path)}">${icon("download")}</a>
        ${reason ? "" : `<button class="btn primary" id="savefile" disabled title="Save (Ctrl+S)">${icon("save")} Save</button>`}
        <button class="btn ghost" id="closefile" title="Close">${icon("x")}</button>
      </div>
      <div class="fb-code">${reason ? `<div class="fb-placeholder">${icon("file")}<p>${esc(reason)}</p></div>` : loading("")}</div>`;
    drawEditorHead();
    drawList(); // highlight the open file
    editor.querySelector("#closefile").onclick = () => closeFile();
    if (reason) return;
    editor.querySelector("#savefile").onclick = save;
    const code = editor.querySelector(".fb-code");
    try {
      const cm = await codeEditor(code, text, path.split("/").pop()); // the first time, this also loads CodeMirror
      if (id !== openId) return;
      code.querySelector(".fb-loading")?.remove();
      open.cm = cm;
    } catch { return toast("The editor couldn't load. Check your connection and try again.", "error"); }
    open.cm.on("change", drawEditorHead);
    open.cm.focus();
  }

  async function closeFile(force = false) {
    if (!force && dirty() && !(await ask({ title: "Discard your changes?", text: `${open.path} has unsaved changes.`, ok: "Discard", danger: true }))) return;
    open = null;
    drawEmpty();
    drawList();
  }

  async function save() {
    if (!open?.cm) return;
    const text = open.cm.getValue();
    try {
      await api(`${base}/files/text`, { method: "PUT", body: { path: open.path, text } });
      open.saved = text;
      drawEditorHead();
      toast("Saved");
      if (parentOf(open.path) === d.path) reload(); // new size / new file in the list
    } catch (err) { toast(err.message, "error"); }
  }

  // --- toolbar, uploads, keyboard ------------------------------------------

  box.querySelector("#filter").oninput = drawList;

  box.querySelector("#newdir").onclick = async () => {
    const name = await askText({ title: "New folder", label: "Folder name", placeholder: "uploads", ok: "Create" });
    if (!name) return;
    try { await api(`${base}/files/folder`, { method: "POST", body: { path: join(name) } }); reload(); }
    catch (err) { toast(err.message, "error"); }
  };
  box.querySelector("#newfile").onclick = async () => {
    const name = await askText({ title: "New file", label: "File name", placeholder: "config.json", ok: "Create" });
    if (name) openFile(join(name), ""); // saved when you press Save
  };

  async function upload(files) {
    for (const file of files) {
      toast(`Uploading ${file.name}…`);
      const res = await fetch(`${base}/files/upload?path=${encodeURIComponent(join(file.name))}`, { method: "POST", body: file });
      if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? `Couldn't upload ${file.name}.`, "error");
    }
    toast(files.length === 1 ? "Uploaded" : `${files.length} files uploaded`);
    reload();
  }
  box.querySelector("#up").onchange = (e) => upload([...e.target.files]);

  // Drag files from your computer onto the list.
  const side = box.querySelector(".fb-side");
  side.ondragover = (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); side.classList.add("dragging"); } };
  side.ondragleave = (e) => { if (!side.contains(e.relatedTarget)) side.classList.remove("dragging"); };
  side.ondrop = (e) => { e.preventDefault(); side.classList.remove("dragging"); upload([...e.dataTransfer.files]); };

  // Ctrl+S / Cmd+S saves. Closing the tab with unsaved changes asks first.
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s" && open?.cm) { e.preventDefault(); save(); } };
  const onLeave = (e) => { if (dirty()) e.preventDefault(); };
  document.addEventListener("keydown", onKey);
  addEventListener("beforeunload", onLeave);

  drawAll();
  drawEmpty();
  return () => { document.removeEventListener("keydown", onKey); removeEventListener("beforeunload", onLeave); };
}

// A spinner with a short text, centered in its box.
const loading = (text) => `<div class="fb-loading"><span class="spinner"></span>${text ? `<span>${text}</span>` : ""}</div>`;
