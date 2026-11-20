// Settings: the sidebar shows these pages (like it does inside an app). Each page has its own file.
import { securityPage } from "./settings-security.js";
import { alertsPage } from "./alerts.js";
import { domainPage } from "./settings-domain.js";

// [id, label, icon] — the sidebar is built from this list. The first one opens by default.
export const SETTINGS = [
  ["security", "Security", "lock"],
  ["alerts", "Alerts", "alert"],
  ["domain", "Domain", "globe"],
];

const PAGES = { security: securityPage, alerts: alertsPage, domain: domainPage };

export function settingsScreen(view, section) {
  const page = PAGES[section] ?? securityPage;
  return page(view);
}
