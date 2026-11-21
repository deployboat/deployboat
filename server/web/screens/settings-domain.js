// Settings → Domain: *.example.com for every app, and (optionally) a separate dashboard address.
import { api, esc, toast } from "../app.js";
import { ask } from "../dialog.js";
import { dnsHelp, recordBox, wireCopy } from "./dns.js";

export async function domainPage(view) {
  view.innerHTML = `
    <p class="muted tabintro">Give every app an address under a domain you own, like <code>blog.example.com</code>.</p>
    <div class="card pad" id="domain"></div>`;
  await domainSection(view.querySelector("#domain"));
}

// Your domain: *.example.com for every app, and (optionally) a separate dashboard address.
// The free nip.io addresses keep working whatever you choose here.
async function domainSection(el, pending) {
  if (!el.isConnected) return;
  const d = await api("/api/settings/domain");
  const own = !!d.base;
  // `pending`: a domain that was checked but not saved, because DNS isn't right yet.
  const checks = pending?.checks ?? d.checks;
  const baseVal = pending?.base ?? d.base;
  const dashVal = pending?.dashboard ?? d.dashboard;
  el.innerHTML = `
    <b>Your domain</b>
    <p class="muted" style="margin:2px 0 10px">${own
      ? `Apps live at <code>&lt;name&gt;.${esc(d.base)}</code>. Dashboard: <a href="https://${esc(d.dashboardHost)}">${esc(d.dashboardHost)}</a>.`
      : `Apps use free addresses like <code>&lt;name&gt;.${esc(d.nipDomain)}</code>. Use a domain you own to get <code>&lt;name&gt;.example.com</code> instead.`}
      The free addresses keep working as a backup, so you can't lock yourself out.</p>
    <form class="form card pad" style="background:var(--bg)">
      <label>Domain for apps
        <input name="base" value="${esc(baseVal)}" placeholder="example.com or apps.example.com" autocomplete="off">
        <span class="note">Every app gets a name under it: <code>blog.example.com</code>, <code>shop.example.com</code>…</span></label>
      ${checks?.base ? dnsHelp(checks.base) : !baseVal ? `<div><p class="note" style="margin-bottom:6px">You'll add one record where you bought the domain (it works for all apps):</p>
        ${recordBox({ type: "A", name: "*", value: d.ip })}</div>` : ""}
      <details ${dashVal ? "open" : ""}>
        <summary class="note" style="cursor:pointer">Dashboard address (optional)</summary>
        <label style="margin-top:8px">Dashboard at
          <input name="dashboard" value="${esc(dashVal)}" placeholder="${esc(baseVal ? `deployboat.${baseVal}` : "panel.example.com")}" autocomplete="off">
          <span class="note">Leave empty to use <code>deployboat.</code> + the domain above.</span></label>
        ${checks?.dashboard ? dnsHelp(checks.dashboard) : ""}
      </details>
      <div class="row" style="justify-content:flex-end">
        ${own ? `<button type="button" class="btn danger" id="domoff">Back to free addresses</button>` : ""}
        ${pending ? `<button type="button" class="btn" id="force">Save anyway</button>` : ""}
        <button class="btn primary">Check DNS &amp; save</button>
      </div>
    </form>`;
  wireCopy(el);
  const f = el.querySelector("form");

  const save = async (force) => {
    const body = { base: f.base.value, dashboard: f.dashboard.value, force };
    const btn = f.querySelector(".primary"); btn.disabled = true; btn.textContent = "Checking DNS…";
    try {
      const r = await api("/api/settings/domain", { method: "PUT", body });
      if (!r.saved) { toast("Not saved yet: DNS needs a change. See below."); return domainSection(el, { ...body, checks: r.checks }); }
      toast("Saved. HTTPS for the new addresses is set up on the first visit.");
      if (r.dashboardHost !== location.host && await ask({ title: "Open the dashboard at its new address?", text: `https://${r.dashboardHost}\n\nYou'll log in once more there, with the same token.`, ok: "Open it", cancel: "Stay here" })) {
        location.href = `https://${r.dashboardHost}/`;
        return;
      }
      domainSection(el);
    } catch (err) { toast(err.message, "error"); btn.disabled = false; btn.textContent = "Check DNS & save"; }
  };
  f.onsubmit = (e) => { e.preventDefault(); save(false); };
  el.querySelector("#force")?.addEventListener("click", async () => {
    if (await ask({ title: "Save even though DNS isn't right yet?", text: "The new addresses won't work until it is. The free addresses keep working.", ok: "Save anyway" })) save(true);
  });
  el.querySelector("#domoff")?.addEventListener("click", async () => {
    if (!(await ask({ title: "Go back to the free addresses?", text: `Addresses under ${d.base} stop working, and apps use …${d.nipDomain} again. Apps' own domains (like myshop.com) are not affected.`, ok: "Go back", danger: true }))) return;
    await api("/api/settings/domain", { method: "PUT", body: { base: "", dashboard: "" } });
    toast("Back to the free addresses");
    if (location.host !== d.nipDashboard) location.href = `https://${d.nipDashboard}/#/settings/domain`;
    else domainSection(el);
  });

  // While DNS isn't right, check again every 20 seconds.
  if (pending || (checks && Object.values(checks).some((c) => c && !c.ok))) {
    setTimeout(async () => {
      if (!el.isConnected || el.contains(document.activeElement)) return;
      if (!pending) return domainSection(el);
      const r = await api("/api/settings/domain", { method: "PUT", body: { base: pending.base, dashboard: pending.dashboard } }).catch(() => null);
      if (r?.saved) { toast("DNS is right now. Saved."); domainSection(el); }
      else if (r) domainSection(el, { ...pending, checks: r.checks });
    }, 20000);
  }
}
