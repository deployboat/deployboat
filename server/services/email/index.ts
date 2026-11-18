// Email for apps: one email provider (SMTP), set up once in Settings.
// Apps that add "email" get SMTP_* variables pointing at it.
// Sending straight from the server isn't reliable (blocked ports, spam folders),
// so we always go through a real provider.
import { getEnv, setEnv, deleteEnv } from "../../lib/env.ts";
import { getSetting, setSetting } from "../../lib/settings.ts";

export type Mail = { host: string; port: number; user: string; pass: string; from: string };

export const getMail = () => getSetting<Mail | { host: "" }>("mail", { host: "" }) as Mail;
export const saveMail = (m: Mail | null) => setSetting("mail", m ?? { host: "" });
export const mailReady = () => !!getMail().host;

const VARS = ["SMTP_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"];

export const enabled = (app: string) => !!getEnv(app).SMTP_HOST;

// Write (or refresh) the app's SMTP variables from the server's email settings.
function writeVars(app: string) {
  const m = getMail();
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

export async function provision(app: string, log: (l: string) => void) {
  if (!mailReady()) throw new Error("Set up an email provider first: Settings → Email for apps.");
  if (!enabled(app)) log("→ Adding email…");
  writeVars(app); // also picks up changed provider settings on every deploy
}

export async function rename() { /* nothing tied to the name */ }

export async function destroy(app: string) {
  for (const k of VARS) deleteEnv(app, k);
}
