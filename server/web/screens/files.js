// App → Files: browse the app's persistent folders (/data and any extra ones).
// Open a text file to read or edit it; upload, download, make folders, delete.
// The folder you're in is part of the address (#/apps/<app>/files?path=/data/uploads),
// so the back button goes up a level.
import { api, esc, icon, toast, bytes, timeAgo } from "../app.js";

// The ?path= part of the address, if any.
const pathFromHash = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("path");

export async function filesPage(box, base, app) {
  const path = pathFromHash() || app.folders[0];
  const d = await api(`${base}/files?path=${encodeURIComponent(path)}`);
  const root = d.folders.find((f) => path === f || path.startsWith(`${f}/`)) ?? d.folders[0];
  const go = (p) => (location.hash = `#/apps/${encodeURIComponent(app.name)}/files?path=${encodeURIComponent(p)}`);
  const join = (name) => `${d.path.replace(/\/$/, "")}/${name}`;

  // "/data/uploads/2024" → links for /data, uploads, 2024.
  const parts = d.path.slice(root.length).split("/").filter(Boolean);
  const crumbs = [[root, root], ...parts.map((p, i) => [p, root + "/" + parts.slice(0, i + 1).join("/")])];

  box.innerHTML = `
    <div class="row spread" style="margin-bottom:12px">
      <div class="chips">${d.folders.map((f) => `
        <button data-root="${esc(f)}" class="${f === root ? "on" : ""}">${icon("folder")}${esc(f)}</button>`).join("")}</div>
      <span class="muted" style="font-size:13px">${bytes(d.usage.bytes)} · ${d.usage.files.toLocaleString()} ${d.usage.files === 1 ? "file" : "files"} in all folders</span>
    </div>

    <div class="card">
      <div class="row spread pad filebar">
        <div class="crumbs">${crumbs.map(([label, p], i) => i === crumbs.length - 1
          ? `<b>${esc(label)}</b>` : `<a data-go="${esc(p)}">${esc(label)}</a><span class="muted">/</span>`).join("")}</div>
        <div class="row" style="gap:6px">
          <button class="btn" id="newfile">${icon("file")} New file</button>
          <button class="btn" id="newdir">${icon("folder")} New folder</button>
          <label class="btn primary">${icon("upload")} Upload<input type="file" multiple hidden id="up"></label>
        </div>
      </div>
      <div id="editor"></div>
      <div class="list files">
        ${parts.length ? `<div class="filerow" data-go="${esc(crumbs[crumbs.length - 2][1])}">${icon("back")}<span class="grow muted">Up one level</span></div>` : ""}
        ${d.entries.map((e) => `
          <div class="filerow" ${e.dir ? `data-go="${esc(join(e.name))}"` : `data-open="${esc(join(e.name))}"`}>
            ${icon(e.dir ? "folder" : "file")}
            <span class="grow">${esc(e.name)}</span>
            <span class="muted fsize">${e.dir ? "" : bytes(e.size)}</span>
            <span class="muted fdate">${timeAgo(e.modified)}</span>
            ${e.dir ? "" : `<a class="btn ghost" title="Download" href="${base}/files/download?path=${encodeURIComponent(join(e.name))}">${icon("download")}</a>`}
            <button class="btn ghost" data-del="${esc(join(e.name))}" data-dir="${e.dir}" title="Delete">${icon("trash")}</button>
          </div>`).join("")
          || `<div class="muted">Empty. Files your app saves in <code>${esc(d.path)}</code> show up here.</div>`}
      </div>
    </div>
    <p class="note" style="margin-top:10px">Only folders in Persistent storage (on the Overview) are shown: everything else in the app is reset on each deploy.</p>`;

  box.querySelectorAll("[data-root]").forEach((b) => (b.onclick = () => go(b.dataset.root)));
  box.querySelectorAll("[data-go]").forEach((el) => (el.onclick = () => go(el.dataset.go)));
  box.querySelectorAll("[data-open]").forEach((el) => (el.onclick = (e) => {
    if (e.target.closest("a, button")) return; // the download/delete buttons
    openFile(box.querySelector("#editor"), base, el.dataset.open);
  }));
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const what = b.dataset.dir === "true" ? "this folder and everything in it" : "this file";
    if (!confirm(`Delete ${what}?\n\n${b.dataset.del}\n\nYour app may need it. This can't be undone (unless it's in a backup).`)) return;
    try { await api(`${base}/files?path=${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Deleted"); refresh(); }
    catch (err) { toast(err.message); }
  }));

  // Redraw the same folder (go() alone does nothing if the address didn't change).
  const refresh = () => filesPage(box, base, app);

  box.querySelector("#newdir").onclick = async () => {
    const name = prompt("Folder name");
    if (!name) return;
    try { await api(`${base}/files/folder`, { method: "POST", body: { path: join(name) } }); refresh(); }
    catch (err) { toast(err.message); }
  };
  box.querySelector("#newfile").onclick = () => {
    const name = prompt("File name, like config.json");
    if (name) openFile(box.querySelector("#editor"), base, join(name), "", refresh);
  };
  box.querySelector("#up").onchange = async (e) => {
    for (const file of e.target.files) {
      toast(`Uploading ${file.name}…`);
      const res = await fetch(`${base}/files/upload?path=${encodeURIComponent(join(file.name))}`, { method: "POST", body: file });
      if (!res.ok) { toast((await res.json().catch(() => ({}))).error ?? `Couldn't upload ${file.name}.`); return; }
    }
    toast("Uploaded");
    refresh();
  };
}

// Show a file above the list: editable if it's text, otherwise a note to download it.
// `text` is given for a new file; otherwise it's loaded.
async function openFile(el, base, path, text, done) {
  let reason = null;
  if (text === undefined) {
    try { ({ text, reason } = await api(`${base}/files/text?path=${encodeURIComponent(path)}`)); }
    catch (err) { return toast(err.message); }
  }
  el.innerHTML = `
    <div class="inset">
      <div class="row spread" style="margin-bottom:8px"><code>${esc(path)}</code>
        <button class="btn ghost" data-x title="Close">${icon("x")}</button></div>
      ${reason ? `<p class="muted">${esc(reason)}</p>` : `
        <textarea class="code" spellcheck="false" rows="16">${esc(text)}</textarea>
        <div class="row" style="gap:6px;margin-top:8px;justify-content:flex-end">
          <span class="note grow">Your app reads the new content the next time it opens the file.</span>
          <button class="btn primary" id="savefile">${icon("save")} Save</button></div>`}
    </div>`;
  el.querySelector("[data-x]").onclick = () => (el.innerHTML = "");
  el.querySelector("textarea")?.focus();
  el.querySelector("#savefile")?.addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      await api(`${base}/files/text`, { method: "PUT", body: { path, text: el.querySelector("textarea").value } });
      toast("Saved");
      done?.();
    } catch (err) { toast(err.message); }
    b.disabled = false;
  });
}
