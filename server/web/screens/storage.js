// App → Storage: the app's file storage (an S3 bucket on this server, see services/files).
//
//   Files            browse the bucket: folders, upload (button or drag and drop), copy link, delete
//   Use it in your app   code examples; the app already has the S3_* variables
//   Connection details   endpoint, bucket and keys, for other tools
//
// Every file is public at <public URL>/<name>, so links and image previews use that address.
import { api, esc, icon, toast, copy, bytes, timeAgo } from "../app.js";
import { ask, askText } from "../dialog.js";
import { field, wireFields, removeServiceBox } from "./app.js";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;

export async function storagePage(box, base, app, addServicePage) {
  if (!app.services.includes("storage")) return addServicePage(box, base, "storage");
  const s = await api(`${base}/storage`);
  let prefix = "", next = null, entries = { folders: [], files: [] };

  box.innerHTML = `
    <div class="stats">
      <div class="card stat"><b id="count">${s.objects.toLocaleString()}</b><span>files</span></div>
      <div class="card stat"><b id="used">${esc(s.size)}</b><span>used</span></div>
      <div class="card stat stlink"><span>Public address</span>
        <div class="row" style="gap:4px;flex-wrap:nowrap"><code class="grow">${esc(s.publicUrl.replace("https://", ""))}</code>
          <button class="btn ghost" data-copy="${esc(s.publicUrl)}" title="Copy">${icon("copy")}</button></div></div>
    </div>

    <div class="card stfiles">
      <div class="stbar">
        <div class="fb-crumbs" id="crumbs"></div>
        <div class="row" style="gap:6px;flex-wrap:nowrap">
          <button class="btn" id="newdir">${icon("folder")} New folder</button>
          <label class="btn primary">${icon("upload")} Upload<input type="file" multiple hidden id="up"></label>
        </div>
      </div>
      <div id="progress" class="stprogress" hidden></div>
      <div class="stlist" id="list"></div>
      <div class="fb-drop" id="drop">${icon("upload")} Drop files to upload them here</div>
    </div>

    <div class="card pad" style="margin-top:14px">
      <div class="row spread"><b>Use it in your app</b>
        <div class="chips" id="langs">${Object.keys(SNIPPETS).map((k, i) => `<button data-lang="${k}" class="${i ? "" : "on"}">${k}</button>`).join("")}</div></div>
      <p class="muted" style="font-size:13px;margin:4px 0 10px">Your app already has the <code>S3_*</code> variables (and <code>AWS_*</code>, which AWS SDKs read by themselves). Nothing to paste.</p>
      <pre class="log" id="snippet" style="max-height:none"></pre>
      <p class="note" style="margin-top:8px">Files are public at <code>${esc(s.publicUrl)}/&lt;name&gt;</code>. Storage is only reachable from apps on this server, so upload through your app, not straight from the browser.</p>
    </div>

    <details class="card stdetails" style="margin-top:14px">
      <summary class="pad"><span class="chev">${icon("chevron")}</span><b>Connection details</b><span class="note">For other tools, like an S3 browser on this server</span></summary>
      <div class="pad" style="padding-top:0"><dl class="info">
        ${field("Endpoint", s.endpoint)}
        ${field("Region", s.region)}
        ${field("Bucket", s.bucket)}
        ${field("Access key", s.accessKey)}
        ${field("Secret key", s.secretKey, { secret: true })}
      </dl></div>
    </details>`;
  wireFields(box);
  removeServiceBox(box, base, app, "storage");

  // --- code examples -----------------------------------------------------------
  const showLang = (k) => {
    box.querySelectorAll("[data-lang]").forEach((b) => b.classList.toggle("on", b.dataset.lang === k));
    box.querySelector("#snippet").textContent = SNIPPETS[k];
  };
  box.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => showLang(b.dataset.lang)));
  showLang(Object.keys(SNIPPETS)[0]);

  // --- the file browser ---------------------------------------------------------
  const list = box.querySelector("#list");
  const url = (key) => `${s.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const nameOf = (key) => key.replace(/\/$/, "").split("/").pop();

  async function load(p = prefix, more = false) {
    if (!more) list.classList.add("busy");
    try {
      const r = await api(`${base}/storage/files?prefix=${encodeURIComponent(p)}${more && next ? `&next=${encodeURIComponent(next)}` : ""}`);
      prefix = p; next = r.next;
      entries = more ? { folders: entries.folders.concat(r.folders), files: entries.files.concat(r.files) } : r;
      draw();
    } catch (err) { toast(err.message, "error"); }
    list.classList.remove("busy");
  }

  function draw() {
    // "avatars/2026/" → Storage / avatars / 2026
    const parts = prefix.split("/").filter(Boolean);
    box.querySelector("#crumbs").innerHTML = `<a data-go="">${icon("drive")} ${esc(s.bucket)}</a>`
      + parts.map((p, i) => `<span>/</span><a data-go="${esc(parts.slice(0, i + 1).join("/") + "/")}">${esc(p)}</a>`).join("");
    box.querySelectorAll("#crumbs [data-go]").forEach((a) => (a.onclick = () => load(a.dataset.go)));

    const { folders, files } = entries;
    list.innerHTML = `
      ${prefix ? `<div class="strow" data-go="${esc(parts.slice(0, -1).join("/") + (parts.length > 1 ? "/" : ""))}">
        <span class="stthumb">${icon("back")}</span><span class="grow muted">Up one level</span></div>` : ""}
      ${folders.map((f) => `
        <div class="strow" data-go="${esc(f)}">
          <span class="stthumb">${icon("folder")}</span>
          <span class="grow stname">${esc(nameOf(f))}</span>
          <span class="stmeta"></span><span class="stmeta"></span>
          <span class="stacts"><button class="btn ghost danger" data-del="${esc(f)}" title="Delete folder">${icon("trash")}</button></span>
        </div>`).join("")}
      ${files.map((f) => `
        <div class="strow file">
          <span class="stthumb">${icon("file")}${IMAGE.test(f.key) ? `<img src="${esc(url(f.key))}" loading="lazy" alt="" onerror="this.remove()">` : ""}</span>
          <a class="grow stname" href="${esc(url(f.key))}" target="_blank">${esc(nameOf(f.key))}</a>
          <span class="stmeta">${bytes(f.size)}</span>
          <span class="stmeta">${f.modified ? timeAgo(f.modified.replace("T", " ").replace(/\.\d+/, "").replace("Z", "")) : ""}</span>
          <span class="stacts">
            <button class="btn ghost" data-copy="${esc(url(f.key))}" title="Copy link">${icon("link")}</button>
            <a class="btn ghost" href="${esc(url(f.key))}" target="_blank" title="Open">${icon("external")}</a>
            <button class="btn ghost danger" data-del="${esc(f.key)}" title="Delete">${icon("trash")}</button>
          </span>
        </div>`).join("")}
      ${!folders.length && !files.length ? `<div class="stempty">${icon("upload")}
        <p><b>${prefix ? "This folder is empty." : "No files yet."}</b></p>
        <p class="note">Upload here, or let your app save files. They show up here either way.</p></div>` : ""}
      ${next ? `<button class="btn stmore" id="more">Show more</button>` : ""}`;

    list.querySelectorAll("[data-go]").forEach((r) => (r.onclick = (e) => { if (!e.target.closest("button")) load(r.dataset.go); }));
    list.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    list.querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); remove(b.dataset.del); }));
    list.querySelector("#more")?.addEventListener("click", () => load(prefix, true));
  }

  async function remove(key) {
    const folder = key.endsWith("/");
    if (!(await ask({ title: `Delete ${folder ? `the folder "${nameOf(key)}"` : `"${nameOf(key)}"`}?`, ok: "Delete", danger: true,
      text: `${folder ? "Every file in it is deleted. " : ""}Links to ${folder ? "these files" : "it"} stop working. This can't be undone (unless it's in a backup).` }))) return;
    try {
      const r = await api(`${base}/storage/files?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      toast(folder ? `Deleted ${r.deleted} file${r.deleted === 1 ? "" : "s"}` : "Deleted");
    } catch (err) { return toast(err.message, "error"); }
    load(); refreshStats();
  }

  // Upload one by one, with a progress line. Files keep their names, in the folder you're in.
  async function upload(files) {
    const bar = box.querySelector("#progress");
    bar.hidden = false;
    let done = 0;
    for (const file of files) {
      bar.innerHTML = `<span class="spinner sm"></span> Uploading ${esc(file.name)} (${done + 1} of ${files.length})…`;
      const res = await fetch(`${base}/storage/files?key=${encodeURIComponent(prefix + file.name)}`, {
        method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" },
      }).catch(() => null);
      if (!res?.ok) {
        bar.hidden = true;
        toast((await res?.json().catch(() => null))?.error ?? `Couldn't upload ${file.name}.`, "error");
        return load();
      }
      done++;
    }
    bar.hidden = true;
    toast(done === 1 ? "Uploaded" : `${done} files uploaded`);
    load(); refreshStats();
  }
  box.querySelector("#up").onchange = (e) => { upload([...e.target.files]); e.target.value = ""; };

  // S3 has no empty folders: a new folder exists once a file is in it. So "New folder" just opens it.
  box.querySelector("#newdir").onclick = async () => {
    const name = (await askText({ title: "New folder", label: "Folder name", placeholder: "avatars", ok: "Open folder" }))?.replace(/^\/+|\/+$/g, "");
    if (!name) return;
    prefix += name + "/";
    entries = { folders: [], files: [] }; next = null;
    draw();
    toast("Upload a file to keep this folder.");
  };

  // Drag files from your computer onto the list.
  const card = box.querySelector(".stfiles");
  card.ondragover = (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); card.classList.add("dragging"); } };
  card.ondragleave = (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("dragging"); };
  card.ondrop = (e) => { e.preventDefault(); card.classList.remove("dragging"); upload([...e.dataTransfer.files]); };

  async function refreshStats() {
    const now = await api(`${base}/storage`).catch(() => null);
    if (!now || !box.isConnected) return;
    box.querySelector("#count").textContent = now.objects.toLocaleString();
    box.querySelector("#used").textContent = now.size;
  }

  load("");
}

// Short, working examples. They only use the variables the app already has.
const SNIPPETS = {
  "Node.js": `// npm install @aws-sdk/client-s3
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ forcePathStyle: true }); // reads the AWS_* variables

await s3.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET,
  Key: "avatars/42.png",
  Body: fileBuffer,
  ContentType: "image/png",
}));

const link = \`\${process.env.S3_PUBLIC_URL}/avatars/42.png\`;`,
  Python: `# pip install boto3
import os, boto3
from botocore.config import Config

s3 = boto3.client("s3", config=Config(s3={"addressing_style": "path"}))  # reads AWS_*

s3.upload_file("photo.png", os.environ["S3_BUCKET"], "avatars/42.png",
               ExtraArgs={"ContentType": "image/png"})

link = f"{os.environ['S3_PUBLIC_URL']}/avatars/42.png"`,
  Variables: `S3_ENDPOINT     where storage is (inside this server)
S3_REGION       garage
S3_BUCKET       your app's bucket
S3_ACCESS_KEY   key id
S3_SECRET_KEY   secret
S3_PUBLIC_URL   https://… : public links to your files

AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY:
the same values under the names AWS SDKs read by themselves.`,
};
