// DNS help: shows the record to add and, when something's wrong, what to change.
// Used by app Domains and Settings → Your domain.
import { esc, icon, copy } from "../app.js";

// The one record that should exist, with copy buttons.
export function recordBox(r) {
  return `<div class="dnsrec">
    <div><span>Type</span><code>${esc(r.type)}</code></div>
    <div><span>Name</span><code>${esc(r.name)}</code><button class="btn ghost" data-copy="${esc(r.name)}" title="Copy">${icon("copy")}</button></div>
    <div><span>Value</span><code>${esc(r.value)}</code><button class="btn ghost" data-copy="${esc(r.value)}" title="Copy">${icon("copy")}</button></div>
  </div>`;
}

// Full help for one check: what's wrong (if anything) + the record.
export function dnsHelp(c) {
  if (!c) return "";
  if (c.ok) return `<p class="dnsok">${icon("check")} DNS is right: <b>${esc(c.host)}</b> points to this server.</p>`;
  return `<div class="dnshelp">
    ${c.problems.map((p) => `<div class="dnsprob"><b>${esc(p.title)}</b><p>${esc(p.fix)}</p></div>`).join("")}
    <p class="note" style="margin:10px 0 6px">The record you need${c.zone ? ` in <b>${esc(c.zone)}</b>` : ""}:</p>
    ${recordBox(c.record)}
    <p class="note" style="margin-top:8px">Changes usually show up within minutes, sometimes up to an hour. This page checks again by itself.</p>
  </div>`;
}

// Wire up the copy buttons inside `el`.
export function wireCopy(el) {
  el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); copy(b.dataset.copy); }));
}
