// App → Variables: the app's environment variables (API keys, settings…).
//
//   Your variables      add one, paste a whole .env file, edit, rename, delete, download
//   Set by Deploy Boat  DATABASE_URL, S3_*… (from the app's services), shown but not editable
//
// Every save restarts the app once, so it reads the new values. Values are hidden until "Show".
import { api, esc, icon, toast, copy } from "../app.js";

// Deploy Boat's own variables, grouped, with what they're for.
const BUILTIN_GROUPS = [
  ["Database", /^(DATABASE_URL|SQLITE_PATH)$/, "From the app's database. See the Database page."],
  ["Storage", /^(S3_|AWS_)/, "From the app's file storage. See the Storage page."],
];

// Turn what someone typed into a valid name: "stripe key" → "STRIPE_KEY".
const cleanName = (s) => s.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "");

// KEY=value lines from a .env file. Handles quotes, "export ", comments and empty lines.
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) {
      value = value.slice(1, -1);
      if (q === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else value = value.replace(/\s+#.*$/, ""); // "value # comment"
    out[key] = value;
  }
  return out;
}

// A value for a .env file: quoted when it needs to be.
const envValue = (v) => (/^[\w./:@+-]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);

export async function variablesPage(box, base, app) {
  let vars = [];
  let editing = null;          // the key being edited
  const shown = new Set();     // keys whose value is visible
  let builtinOpen = false;     // is "Set by Deploy Boat" unfolded (kept across redraws)

  box.innerHTML = `
    <div class="varbar">
      <div class="fb-filter varsearch">${icon("search")}<input id="q" placeholder="Search variables" autocomplete="off"></div>
      <span class="grow"></span>
      <button class="btn" id="download" title="Download as a .env file">${icon("download")} .env</button>
      <button class="btn" id="paste">${icon("list")} Paste .env</button>
      <button class="btn primary" id="add">${icon("plus")} Add variable</button>
    </div>
    <div id="formbox"></div>
    <div id="mine"></div>
    <div id="builtin"></div>
    <p class="note" style="margin-top:10px">Saving restarts the app (a few seconds) so it reads the new values. <code>PORT</code> and <code>DATA_DIR</code> are always set for you.</p>`;

  const save = async (body, message) => {
    await api(`${base}/env`, { method: "PUT", body });
    toast(`${message}. The app restarted.`);
    await load();
  };

  async function load() {
    vars = await api(`${base}/env`);
    if (box.isConnected) draw();
  }

  function draw() {
    const q = box.querySelector("#q").value.trim().toLowerCase();
    const match = (v) => !q || v.key.toLowerCase().includes(q) || (shown.has(v.key) && (v.value ?? "").toLowerCase().includes(q));
    const mine = vars.filter((v) => !v.builtin && match(v));
    const builtin = vars.filter((v) => v.builtin && match(v));
    const total = vars.filter((v) => !v.builtin).length;

    box.querySelector("#mine").innerHTML = `
      <div class="card vartable">
        <div class="varhead"><span>Name</span><span>Value</span><span></span></div>
        ${mine.map(row).join("")}
        ${!mine.length ? `<div class="varempty">${q ? "No variable matches." : `${icon("key")}<b>No variables yet</b>
          <span class="note">Add API keys and settings your app reads, like <code>STRIPE_SECRET_KEY</code> or <code>NODE_ENV</code>. Or paste your .env file.</span>`}</div>` : ""}
      </div>
      ${total ? `<p class="note varcount">${total} variable${total === 1 ? "" : "s"}</p>` : ""}`;

    // Deploy Boat's own, folded, grouped by where they come from.
    box.querySelector("#builtin").innerHTML = builtin.length ? `
      <details class="card vardetails" ${q || builtinOpen ? "open" : ""}>
        <summary><span class="chev">${icon("chevron")}</span>${icon("lock")}<b>Set by Deploy Boat</b>
          <span class="note">${builtin.length} · from this app's services, can't be edited here</span></summary>
        <div class="vargrid">${BUILTIN_GROUPS.map(([label, re, why]) => {
          const list = builtin.filter((v) => re.test(v.key));
          return list.length ? `<div class="vargroup"><b>${label}</b><span class="note">${why}</span></div>${list.map((v) => row(v)).join("")}` : "";
        }).join("")}</div>
      </details>` : "";

    wire();
  }

  function row(v) {
    if (editing === v.key) return `
      <form class="varrow editing" data-form="${esc(v.key)}">
        <div class="varcell"><input name="key" value="${esc(v.key)}" spellcheck="false" required></div>
        <div class="varcell"><textarea name="value" rows="${Math.min(6, (v.value ?? "").split("\n").length)}" spellcheck="false">${esc(v.value ?? "")}</textarea></div>
        <div class="varcell varacts"><button class="btn primary">Save</button><button type="button" class="btn" data-a="cancel">Cancel</button></div>
      </form>`;
    const visible = shown.has(v.key);
    const value = v.value ?? "";
    return `
      <div class="varrow ${v.builtin ? "builtin" : ""}">
        <div class="varcell"><code class="varkey">${esc(v.key)}</code></div>
        <div class="varcell"><span class="varval ${visible ? "" : "hidden"} ${value ? "" : "blank"}">${!value ? "empty" : visible ? esc(value) : "•".repeat(Math.min(16, Math.max(8, value.length)))}</span></div>
        <div class="varcell varacts">
          <button class="btn ghost" data-a="show" data-key="${esc(v.key)}" title="${visible ? "Hide" : "Show"}">${icon(visible ? "eyeoff" : "eye")}</button>
          <button class="btn ghost" data-a="copy" data-key="${esc(v.key)}" title="Copy value">${icon("copy")}</button>
          ${v.builtin ? "" : `
            <button class="btn ghost" data-a="edit" data-key="${esc(v.key)}" title="Edit">${icon("edit")}</button>
            <button class="btn ghost danger" data-a="delete" data-key="${esc(v.key)}" title="Delete">${icon("trash")}</button>`}
        </div>
      </div>`;
  }

  function wire() {
    box.querySelector(".vardetails")?.addEventListener("toggle", (e) => (builtinOpen = e.target.open));
    box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => act(b.dataset.a, b.dataset.key)));
    const f = box.querySelector("[data-form]");
    if (!f) return;
    f.value.focus();
    f.key.oninput = () => (f.key.value = cleanName(f.key.value));
    f.onkeydown = (e) => { if (e.key === "Escape") { editing = null; draw(); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const old = f.dataset.form, key = cleanName(f.key.value);
      try { await save({ vars: { [key]: f.value.value }, remove: key !== old ? [old] : [] }, key !== old ? `Renamed to ${key}` : `${key} saved`); editing = null; draw(); }
      catch (err) { toast(err.message); }
    };
  }

  async function act(a, key) {
    const v = vars.find((x) => x.key === key);
    if (a === "show") { shown.has(key) ? shown.delete(key) : shown.add(key); return draw(); }
    if (a === "copy") return copy(v?.value ?? "");
    if (a === "edit") { editing = key; shown.add(key); return draw(); }
    if (a === "cancel") { editing = null; return draw(); }
    if (a === "delete") {
      if (!confirm(`Delete ${key}?\n\nThe app restarts without it.`)) return;
      try { await api(`${base}/env/${encodeURIComponent(key)}`, { method: "DELETE" }); toast(`${key} deleted. The app restarted.`); load(); }
      catch (err) { toast(err.message); }
    }
  }

  // --- adding: one variable, or a whole .env file ---------------------------------------

  function addForm() {
    const fb = box.querySelector("#formbox");
    fb.innerHTML = `
      <form class="card varform">
        <div class="varform-row">
          <label>Name<input name="key" placeholder="STRIPE_SECRET_KEY" required spellcheck="false" autocomplete="off"></label>
          <label class="grow">Value<textarea name="value" rows="1" placeholder="sk_live_…" spellcheck="false"></textarea></label>
        </div>
        <p class="note" id="hint">Names: capital letters, numbers and _. Spaces become _ as you type.</p>
        <div class="varform-foot"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${icon("plus")} Add &amp; restart</button></div>
      </form>`;
    const f = fb.querySelector("form");
    f.key.focus();
    f.key.oninput = () => {
      f.key.value = cleanName(f.key.value);
      const exists = vars.some((v) => v.key === f.key.value);
      f.querySelector("#hint").innerHTML = exists ? `${icon("alert")} <b>${esc(f.key.value)}</b> exists already. Adding replaces its value.` : "Names: capital letters, numbers and _. Spaces become _ as you type.";
    };
    // The value box grows for long or multi-line values (like a private key).
    f.value.oninput = () => { f.value.rows = Math.min(8, Math.max(1, f.value.value.split("\n").length)); };
    // Pasting "KEY=value" into the name box fills both.
    f.key.onpaste = (e) => {
      const text = e.clipboardData.getData("text");
      const parsed = parseEnv(text);
      if (Object.keys(parsed).length === 1) { e.preventDefault(); const [[k, v]] = Object.entries(parsed); f.key.value = cleanName(k); f.value.value = v; f.value.focus(); }
      else if (Object.keys(parsed).length > 1) { e.preventDefault(); pasteForm(text); }
    };
    f.querySelector("[data-x]").onclick = () => (fb.innerHTML = "");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const b = f.querySelector(".primary"); b.disabled = true;
      try { await save({ vars: { [f.key.value]: f.value.value } }, `${f.key.value} added`); fb.innerHTML = ""; }
      catch (err) { toast(err.message); b.disabled = false; }
    };
  }

  function pasteForm(text = "") {
    const fb = box.querySelector("#formbox");
    fb.innerHTML = `
      <form class="card varform">
        <b>Paste a .env file</b>
        <p class="note">One <code>NAME=value</code> per line. Comments and empty lines are skipped. Existing names get the new value.</p>
        <textarea name="text" rows="8" spellcheck="false" placeholder="STRIPE_SECRET_KEY=sk_live_…&#10;NODE_ENV=production"></textarea>
        <div id="preview"></div>
        <div class="varform-foot"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" disabled>Add &amp; restart</button></div>
      </form>`;
    const f = fb.querySelector("form"), btn = f.querySelector(".primary");
    const update = () => {
      const parsed = parseEnv(f.text.value);
      const keys = Object.keys(parsed);
      const bad = keys.filter((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || vars.some((v) => v.key === k && v.builtin) || k === "PORT" || k === "DATA_DIR");
      const replace = keys.filter((k) => !bad.includes(k) && vars.some((v) => v.key === k));
      btn.disabled = !keys.length || bad.length > 0;
      btn.textContent = keys.length ? `Add ${keys.length} & restart` : "Add & restart";
      f.querySelector("#preview").innerHTML = keys.length ? `<div class="varpreview">${keys.map((k) => `
        <span class="${bad.includes(k) ? "bad" : replace.includes(k) ? "warn" : ""}" title="${bad.includes(k) ? "Not allowed" : replace.includes(k) ? "Replaces the current value" : "New"}">${esc(k)}</span>`).join("")}</div>
        ${bad.length ? `<p class="note bad">${bad.map(esc).join(", ")}: not allowed (a Deploy Boat variable, or not a valid name).</p>` : replace.length ? `<p class="note">${replace.length} already exist${replace.length === 1 ? "s" : ""} and will be replaced.</p>` : ""}` : "";
    };
    f.text.value = text;
    f.text.oninput = update; update();
    f.text.focus();
    f.querySelector("[data-x]").onclick = () => (fb.innerHTML = "");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const parsed = parseEnv(f.text.value);
      btn.disabled = true;
      try { await save({ vars: parsed }, `${Object.keys(parsed).length} variables saved`); fb.innerHTML = ""; }
      catch (err) { toast(err.message); btn.disabled = false; }
    };
  }

  box.querySelector("#add").onclick = addForm;
  box.querySelector("#paste").onclick = () => pasteForm();
  box.querySelector("#q").oninput = draw;
  box.querySelector("#download").onclick = () => {
    const mine = vars.filter((v) => !v.builtin);
    if (!mine.length) return toast("No variables to download yet.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([mine.map((v) => `${v.key}=${envValue(v.value ?? "")}`).join("\n") + "\n"], { type: "text/plain" }));
    a.download = `${app.name}.env`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  await load();
}
