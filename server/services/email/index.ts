// Email for apps: each app connects its own email provider (SMTP) on its Email page.
// The settings are kept as the app's SMTP_* variables, so the app can read them directly.
// Sending straight from the server isn't reliable (blocked ports, spam folders),
// so we always go through a real provider.
import { getEnv, setEnv, deleteEnv } from "../../lib/env.ts";
import { deleteSetting } from "../../lib/settings.ts";

// Older servers had one provider for all apps in Settings. Apps that used it already
// have their own copy in their SMTP_* variables, so the shared one (with its password) can go.
deleteSetting("mail");

export type Mail = { host: string; port: number; user: string; pass: string; from: string };

const VARS = ["SMTP_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"];

export const enabled = (app: string) => !!getEnv(app).SMTP_HOST;

// The app's current email settings, or null if it has none.
export function getAppMail(app: string): Mail | null {
  const env = getEnv(app);
  if (!env.SMTP_HOST) return null;
  return { host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, user: env.SMTP_USER ?? "", pass: env.SMTP_PASS ?? "", from: env.SMTP_FROM ?? "" };
}

// Save the email settings as the app's SMTP_* variables.
export function saveAppMail(app: string, m: Mail) {
  const secure = m.port === 465;
  const auth = m.user ? `${encodeURIComponent(m.user)}:${encodeURIComponent(m.pass)}@` : "";
  setEnv(app, "SMTP_URL", `${secure ? "smtps" : "smtp"}://${auth}${m.host}:${m.port}`);
  setEnv(app, "SMTP_HOST", m.host);
  setEnv(app, "SMTP_PORT", String(m.port));
  setEnv(app, "SMTP_USER", m.user);
  setEnv(app, "SMTP_PASS", m.pass);
  setEnv(app, "SMTP_FROM", m.from || m.user);
  setEnv(app, "SMTP_SECURE", secure ? "true" : "false");
}

// "Add email" from the CLI or an AI agent. We can't guess the provider's password,
// so a person has to connect it once in the dashboard.
export async function provision(app: string) {
  if (!enabled(app)) throw new Error(`Email needs a provider first. Open ${app} in the Deploy Boat dashboard → Email, and connect one there.`);
}

export async function rename() { /* nothing tied to the name */ }

export async function destroy(app: string) {
  for (const k of VARS) deleteEnv(app, k);
}
