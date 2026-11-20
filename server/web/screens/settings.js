// Settings: one page with tabs (Security, Alerts, Domain). Each tab has its own file.
// The tab is part of the address (#/settings/alerts), so links and the back button work.
import { icon } from "../app.js";
import { securityPage } from "./settings-security.js";
import { alertsPage } from "./alerts.js";
import { domainPage } from "./settings-domain.js";

// [id, label, icon, page] — the tabs are built from this list. The first one opens by default.
const TABS = [
  ["security", "Security", "lock", securityPage],
  ["alerts", "Alerts", "alert", alertsPage],
  ["domain", "Domain", "globe", domainPage],
];

export function settingsScreen(view, section) {
  const tab = TABS.find(([id]) => id === section) ?? TABS[0];
  view.innerHTML = `
    <div class="head"><h1>Settings</h1></div>
    <nav class="tabs">${TABS.map(([id, label, ic]) =>
      `<a href="#/settings/${id}" class="${id === tab[0] ? "on" : ""}">${icon(ic)}${label}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  return tab[3](view.querySelector("#tab"));
}
