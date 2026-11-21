// App → Domains: one table with every address of the app.
//
// The free address (<name>.<server domain>) is a row like the others:
//   edit   = change the name (renames the app; data stays)
//   delete = turn it off (only when the app has a domain of its own). It can come back.
// Your own domains (myshop.com): edit the name, delete, and see their DNS status.
//
// While a domain waits for DNS, the table checks again every 15 seconds. Only the table
// redraws, so what you're typing in the "Add" box stays.
import { api, esc, icon, toast } from "../app.js";
import { ask } from "../dialog.js";
import { dnsHelp, wireCopy } from "./dns.js";

const RECHECK = 15; // seconds

export async function domainsPage(box, base, app) {
  let d = await api(`${base}/domains`);
  let timer = null, countdown = RECHECK;
  let editing = null;          // the host being edited (or "free")
  const openHelp = new Set();  // hosts whose DNS steps are shown
  d.custom.filter((x) => !x.ready).forEach((x) => openHelp.add(x.host));

  box.innerHTML = `
    <div class="card domcard">
      <form class="domadd" id="add">
        <div class="row" style="flex-wrap:nowrap;gap:8px">
          <div class="fb-filter grow">${icon("globe")}<input name="host" placeholder="Add a domain you own, like myshop.com" required autocomplete="off" spellcheck="false"></div>
          <button class="btn primary">${icon("plus")} Add domain</button>
        </div>
        <label class="domwww" hidden><input type="checkbox" name="www" checked> Also add <code id="wwwname"></code> <span class="note">so both work</span></label>
      </form>
      <div id="table"></div>
    </div>
    <p class="note" style="margin-top:10px">HTTPS is set up by itself for every address. Your own domains need one DNS record; each row shows what to add.</p>`;

  // --- the table --------------------------------------------------------------

  function draw() {
    const el = box.querySelector("#table");
    const main = d.address.replace(/^https:\/\//, "");
    const rows = [freeRow(d.free, main), ...d.custom.map((x) => customRow(x, main))];
    const waiting = d.custom.filter((x) => !x.ready).length;
    el.innerHTML = `
      <div class="domtable">
        <div class="domhead"><span>Domain</span><span>Status</span><span></span></div>
        ${rows.join("")}
      </div>
      ${waiting ? `<div class="domfoot"><span class="note" id="countdown"></span>
        <button class="btn ghost" id="checknow">${icon("restart")} Check now</button></div>` : ""}`;
    wireCopy(el);
    wire(el);
    tick();
  }

  // The free address row: on (edit / turn off) or off (turn on).
  function freeRow(f, main) {
    if (!f.on) return `
      <div class="domrow off">
        <div class="domcell"><span class="domhost">${esc(f.host)}</span><span class="tag">Free</span></div>
        <div class="domcell"><span class="domstat">${icon("x")} Turned off</span></div>
        <div class="domacts"><button class="btn" data-a="free-on">Turn on</button></div>
      </div>`;
    if (editing === "free") return `
      <form class="domrow editing" data-form="free">
        <div class="domcell suffixed"><input name="v" value="${esc(app.name)}" pattern="[a-z0-9][a-z0-9\\-]*" maxlength="40" required spellcheck="false">
          <span>.${esc(d.baseDomain)}</span></div>
        <div class="domcell note">Renames the app. The old address stops working; data stays.</div>
        <div class="domacts"><button class="btn primary">Save</button><button type="button" class="btn" data-a="cancel">Cancel</button></div>
      </form>`;
    return `
      <div class="domrow">
        <div class="domcell"><a class="domhost" href="https://${esc(f.host)}" target="_blank">${esc(f.host)}</a>
          <span class="tag">Free</span>${f.host === main ? `<span class="badge">Main</span>` : ""}
          ${f.backup ? `<span class="note domsub">Also <a href="https://${esc(f.backup)}" target="_blank">${esc(f.backup)}</a>, if your server domain's DNS breaks</span>` : ""}</div>
        <div class="domcell"><span class="domstat ok">${icon("check")} Live · HTTPS</span></div>
        ${actions(f.host, "free")}
      </div>`;
  }

  function customRow(x, main) {
    if (editing === x.host) return `
      <form class="domrow editing" data-form="${esc(x.host)}">
        <div class="domcell"><input name="v" value="${esc(x.host)}" required spellcheck="false"></div>
        <div class="domcell note">You'll need a DNS record for the new name.</div>
        <div class="domacts"><button class="btn primary">Save</button><button type="button" class="btn" data-a="cancel">Cancel</button></div>
      </form>`;
    const help = !x.ready && openHelp.has(x.host);
    return `
      <div class="domrow ${x.ready ? "" : "waiting"}">
        <div class="domcell"><a class="domhost" href="https://${esc(x.host)}" target="_blank">${esc(x.host)}</a>
          ${x.host === main ? `<span class="badge">Main</span>` : ""}</div>
        <div class="domcell">${x.ready
          ? `<span class="domstat ok">${icon("check")} Live · HTTPS</span>`
          : `<span class="domstat warn"><span class="spinner sm"></span> Waiting for DNS</span>
             <button class="linkbtn" data-help="${esc(x.host)}">${help ? "Hide steps" : "How to fix"}</button>`}</div>
        ${actions(x.host, x.host)}
      </div>
      ${help ? `<div class="domhelp">${dnsHelp(x.dns)}</div>` : ""}`;
  }

  // Copy, open, edit, delete. `id` is "free" or the host.
  const actions = (host, id) => `
    <div class="domacts">
      <button class="btn ghost" data-copy="https://${esc(host)}" title="Copy">${icon("copy")}</button>
      <a class="btn ghost" href="https://${esc(host)}" target="_blank" title="Open">${icon("external")}</a>
      <button class="btn ghost" data-a="edit" data-id="${esc(id)}" title="Edit">${icon("edit")}</button>
      <button class="btn ghost danger" data-a="delete" data-id="${esc(id)}" title="${id === "free" ? "Turn off" : "Remove"}">${icon("trash")}</button>
    </div>`;

  // --- what the buttons do -----------------------------------------------------

  function wire(el) {
    el.querySelectorAll("[data-help]").forEach((b) => (b.onclick = () => {
      const h = b.dataset.help;
      openHelp.has(h) ? openHelp.delete(h) : openHelp.add(h);
      draw();
    }));
    el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => act(b.dataset.a, b.dataset.id, b)));
    el.querySelector("#checknow")?.addEventListener("click", (e) => recheck(e.currentTarget));
    const form = el.querySelector("[data-form]");
    if (form) {
      form.v.focus(); form.v.select();
      form.onkeydown = (e) => { if (e.key === "Escape") { editing = null; draw(); } };
      form.onsubmit = (e) => { e.preventDefault(); save(form.dataset.form, form.v.value.trim().toLowerCase()); };
    }
  }

  async function act(action, id, btn) {
    if (action === "edit") { editing = id; return draw(); }
    if (action === "cancel") { editing = null; return draw(); }
    btn.disabled = true;
    try {
      if (action === "free-on") {
        await api(`${base}/free-address`, { method: "PUT", body: { on: true } });
        toast("Free address is on again");
      }
      if (action === "delete" && id === "free") {
        if (!d.custom.length) { btn.disabled = false; return toast("Add a domain of your own first, so the app still has an address.", "error"); }
        if (!(await ask({ title: `Turn off ${d.free.host}?`, text: "The app will only be reachable on your own domains. You can turn it back on any time.", ok: "Turn off" }))) { btn.disabled = false; return; }
        await api(`${base}/free-address`, { method: "PUT", body: { on: false } });
        toast("Free address turned off");
      }
      if (action === "delete" && id !== "free") {
        if (!(await ask({ title: `Remove ${id}?`, text: "Visitors on that address won't reach this app anymore. You can add it again later.", ok: "Remove", danger: true }))) { btn.disabled = false; return; }
        await api(`${base}/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Removed");
      }
    } catch (err) { btn.disabled = false; return toast(err.message, "error"); }
    await refresh();
  }

  async function save(id, value) {
    try {
      if (id === "free") {
        if (value === app.name) { editing = null; return draw(); }
        const r = await api(`${base}/rename`, { method: "POST", body: { newName: value } });
        toast("Address changed");
        location.hash = `#/apps/${encodeURIComponent(r.name)}/domains`; // the app has a new name: reload the page
        return;
      }
      await api(`${base}/domains/${encodeURIComponent(id)}`, { method: "PUT", body: { host: value } });
      toast("Domain changed");
      openHelp.add(value);
    } catch (err) { return toast(err.message, "error"); }
    editing = null;
    await refresh();
  }

  async function refresh() {
    try { d = await api(`${base}/domains`); } catch { return; }
    if (!box.isConnected) return;
    countdown = RECHECK;
    draw();
  }

  async function recheck(btn) {
    if (editing) { countdown = RECHECK; return tick(); } // don't redraw under someone's typing
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner sm"></span> Checking…`; }
    const before = new Set(d.custom.filter((x) => x.ready).map((x) => x.host));
    await refresh();
    const now = d.custom.filter((x) => x.ready && !before.has(x.host));
    if (now.length) toast(`${now.map((x) => x.host).join(", ")} is connected 🎉`);
    else if (btn) toast("Not yet. DNS changes can take a few minutes.");
  }

  // Count down to the next automatic check, while something is waiting.
  function tick() {
    clearTimeout(timer);
    if (!d.custom.some((x) => !x.ready) || !box.isConnected) return;
    const el = box.querySelector("#countdown");
    if (el) el.textContent = `Checking DNS again in ${countdown} s`;
    timer = setTimeout(() => (--countdown <= 0 ? recheck() : tick()), 1000);
  }

  // --- add a domain ------------------------------------------------------------

  const add = box.querySelector("#add");
  const clean = (h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // For "myshop.com" (no subdomain), offer www.myshop.com too.
  const isApex = (h) => h.split(".").length === 2 || (/\.(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(h) && h.split(".").length === 3);
  add.host.oninput = () => {
    const h = clean(add.host.value);
    add.querySelector(".domwww").hidden = !(isApex(h) && !d.custom.some((x) => x.host === `www.${h}`));
    add.querySelector("#wwwname").textContent = `www.${h}`;
  };
  add.onsubmit = async (e) => {
    e.preventDefault();
    const btn = add.querySelector(".primary"); btn.disabled = true;
    const host = clean(add.host.value);
    const hosts = [host];
    if (!add.querySelector(".domwww").hidden && add.www.checked) hosts.push(`www.${host}`);
    try {
      for (const h of hosts) {
        const r = await api(`${base}/domains`, { method: "POST", body: { host: h } });
        if (!r.ready) openHelp.add(r.dns.host); // show the steps right away
      }
      toast(hosts.length > 1 ? "Domains added" : "Domain added");
      add.reset(); add.querySelector(".domwww").hidden = true;
    } catch (err) { toast(err.message, "error"); }
    btn.disabled = false;
    await refresh();
  };

  draw();
  return () => clearTimeout(timer);
}
