// App → Domains: every address that reaches the app.
//
//   Free address   <name>.<server domain>, always works. Editable (renames the app).
//   Your domains   domains you own, like myshop.com. We check their DNS and say what to fix.
//
// While a domain waits for DNS, the list checks again every 15 seconds. Only the list
// redraws, so whatever you're typing in the forms stays.
import { api, esc, icon, toast, copy } from "../app.js";
import { openMenu } from "../menu.js";
import { dnsHelp, wireCopy } from "./dns.js";

const RECHECK = 15; // seconds

export async function domainsPage(box, base, app) {
  let d = await api(`${base}/domains`);
  let timer = null, countdown = RECHECK;

  box.innerHTML = `
    <div class="card pad domcard">
      <div class="sethead">
        <span class="tile">${icon("globe")}</span>
        <div class="grow"><b>Free address</b>
          <p class="muted">Always works, with HTTPS. Nothing to set up.</p></div>
      </div>
      <div id="free"></div>
    </div>

    <div class="card domcard" style="margin-top:14px">
      <div class="sethead pad">
        <span class="tile">${icon("link")}</span>
        <div class="grow"><b>Your domains</b>
          <p class="muted">Use a domain you own, like <code>myshop.com</code>. HTTPS is set up automatically once its DNS is right.</p></div>
      </div>
      <form class="domadd pad" id="add">
        <div class="row" style="flex-wrap:nowrap;gap:8px">
          <input name="host" placeholder="myshop.com" required autocomplete="off" spellcheck="false">
          <button class="btn primary">${icon("plus")} Add domain</button>
        </div>
        <label class="domwww" hidden><input type="checkbox" name="www" checked> Also add <code id="wwwname"></code> <span class="note">so both work</span></label>
      </form>
      <div id="list"></div>
    </div>`;

  // --- free address -------------------------------------------------------

  function drawFree(editing = false) {
    const el = box.querySelector("#free");
    const backup = d.baseDomain !== d.nipDomain ? `${app.name}.${d.nipDomain}` : null;
    if (!editing) {
      el.innerHTML = `
        ${addrRow(d.address, "Live", "ok", `<button class="btn ghost" id="editname" title="Change the address">${icon("edit")}</button>`)}
        ${backup ? addrRow(`https://${backup}`, "Backup", "plain", "", "Works too, even if your server domain's DNS breaks.") : ""}`;
      el.querySelector("#editname").onclick = () => drawFree(true);
      wireCopy(el);
      return;
    }
    el.innerHTML = `
      <form class="domrename">
        <div class="suffixed"><input name="name" value="${esc(app.name)}" pattern="[a-z0-9][a-z0-9\\-]*" maxlength="40" required spellcheck="false">
          <span>.${esc(d.baseDomain)}</span></div>
        <p class="note" id="preview"></p>
        <div class="row" style="gap:6px"><button class="btn primary">Change address</button><button type="button" class="btn" data-x>Cancel</button></div>
      </form>`;
    const f = el.querySelector("form");
    const preview = () => {
      const v = f.name.value.trim().toLowerCase();
      el.querySelector("#preview").innerHTML = v === app.name ? "Type a new name. Only lowercase letters, numbers and dashes."
        : `New address: <b>https://${esc(v)}.${esc(d.baseDomain)}</b>. The old one stops working; your database, files and data stay.`;
    };
    f.name.oninput = preview; preview();
    f.name.focus(); f.name.select();
    el.querySelector("[data-x]").onclick = () => drawFree();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const newName = f.name.value.trim().toLowerCase();
      if (newName === app.name) return drawFree();
      try {
        const r = await api(`${base}/rename`, { method: "POST", body: { newName } });
        toast("Address changed");
        location.hash = `#/apps/${encodeURIComponent(r.name)}/domains`;
      } catch (err) { toast(err.message); }
    };
  }

  // --- your domains ---------------------------------------------------------

  // Remember which DNS help boxes are open, so a recheck doesn't close them.
  const openHelp = new Set();

  function drawList() {
    const el = box.querySelector("#list");
    const waiting = d.custom.filter((x) => !x.ready).length;
    el.innerHTML = d.custom.length ? `
      <div class="list domlist">${d.custom.map((x) => `
        <div class="domitem ${x.ready ? "ready" : "waiting"}">
          <div class="domline">
            <span class="domstate">${x.ready ? icon("check") : `<span class="spinner sm"></span>`}</span>
            <span class="grow"><a href="https://${esc(x.host)}" target="_blank" class="domhost">${esc(x.host)}</a>
              <span class="note">${x.ready ? "Connected · HTTPS on" : "Waiting for DNS"}</span></span>
            ${x.ready ? "" : `<button class="btn" data-help="${esc(x.host)}">${openHelp.has(x.host) ? "Hide steps" : "How to fix"}</button>`}
            <button class="btn ghost" data-more="${esc(x.host)}" title="More">${icon("dots")}</button>
          </div>
          ${!x.ready && openHelp.has(x.host) ? `<div class="domhelp">${dnsHelp(x.dns)}</div>` : ""}
        </div>`).join("")}
      </div>
      ${waiting ? `<div class="domfoot"><span class="note" id="countdown"></span>
        <button class="btn ghost" id="checknow">${icon("restart")} Check now</button></div>` : ""}`
      : `<div class="domempty">
          <ol class="steps">
            <li><b>Add your domain above.</b> Both <code>myshop.com</code> and <code>www.myshop.com</code> work.</li>
            <li><b>Add one DNS record</b> where you bought it (Namecheap, GoDaddy, Cloudflare…). Usually an <b>A record</b> pointing to <code>${esc(d.ip)}</code>. This page shows exactly what to add.</li>
            <li><b>Wait a few minutes.</b> We check by ourselves and turn on HTTPS once it's right.</li>
          </ol>
        </div>`;
    wireCopy(el);
    el.querySelectorAll("[data-help]").forEach((b) => (b.onclick = () => {
      const h = b.dataset.help;
      openHelp.has(h) ? openHelp.delete(h) : openHelp.add(h);
      drawList();
    }));
    el.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => rowMenu(b, b.dataset.more)));
    el.querySelector("#checknow")?.addEventListener("click", (e) => recheck(e.currentTarget));
    tick();
  }

  function rowMenu(btn, host) {
    openMenu(btn, (menu, close) => {
      menu.innerHTML = `
        <a href="https://${esc(host)}" target="_blank">${icon("external")}<span class="grow">Open</span></a>
        <button data-a="copy">${icon("copy")}<span class="grow">Copy address</span></button>
        <hr>
        <button data-a="remove" class="danger">${icon("trash")}<span class="grow">Remove domain</span></button>`;
      menu.querySelector("a").onclick = close;
      menu.querySelector('[data-a="copy"]').onclick = () => { copy(`https://${host}`); close(); };
      menu.querySelector('[data-a="remove"]').onclick = async () => {
        close();
        if (!confirm(`Remove ${host}?\n\nVisitors on that address won't reach this app anymore. You can add it again later.`)) return;
        try { await api(`${base}/domains/${encodeURIComponent(host)}`, { method: "DELETE" }); toast("Removed"); }
        catch (err) { return toast(err.message); }
        await refresh();
      };
    }, { align: "right" });
  }

  async function refresh() {
    try { d = await api(`${base}/domains`); } catch { return; }
    if (!box.isConnected) return;
    countdown = RECHECK;
    drawList();
  }

  async function recheck(btn) {
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
    if (el) el.textContent = `Checking again in ${countdown} s`;
    timer = setTimeout(() => (--countdown <= 0 ? recheck() : tick()), 1000);
  }

  // --- add a domain ---------------------------------------------------------

  const add = box.querySelector("#add");
  // For "myshop.com" (no subdomain), offer www.myshop.com too.
  const isApex = (h) => h.split(".").length === 2 || /\.(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(h) && h.split(".").length === 3;
  add.host.oninput = () => {
    const h = add.host.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const offer = isApex(h) && !d.custom.some((x) => x.host === `www.${h}`);
    add.querySelector(".domwww").hidden = !offer;
    add.querySelector("#wwwname").textContent = `www.${h}`;
  };
  add.onsubmit = async (e) => {
    e.preventDefault();
    const btn = add.querySelector(".primary"); btn.disabled = true;
    const host = add.host.value.trim();
    const hosts = [host];
    if (!add.querySelector(".domwww").hidden && add.www.checked) hosts.push(`www.${host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`);
    try {
      for (const h of hosts) {
        const r = await api(`${base}/domains`, { method: "POST", body: { host: h } });
        if (!r.ready) openHelp.add(r.dns.host); // show the steps right away
      }
      toast(hosts.length > 1 ? "Domains added" : "Domain added");
      add.reset(); add.querySelector(".domwww").hidden = true;
      await refresh();
    } catch (err) { toast(err.message); await refresh(); }
    btn.disabled = false;
  };

  drawFree();
  d.custom.filter((x) => !x.ready).forEach((x) => openHelp.add(x.host));
  drawList();
  return () => clearTimeout(timer);
}

// One address with a label, a copy button and an open link.
function addrRow(url, label, kind, extra = "", note = "") {
  return `<div class="addr">
    <span class="pill ${kind}">${label}</span>
    <span class="grow"><a href="${esc(url)}" target="_blank" class="domhost">${esc(url.replace(/^https:\/\//, ""))}</a>
      ${note ? `<span class="note">${note}</span>` : ""}</span>
    <button class="btn ghost" data-copy="${esc(url)}" title="Copy">${icon("copy")}</button>
    <a class="btn ghost" href="${esc(url)}" target="_blank" title="Open">${icon("external")}</a>
    ${extra}
  </div>`;
}
