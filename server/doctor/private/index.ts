// "Make your server private": a step-by-step guide in Server Doctor.
//
// The goal: nothing on the internet can reach the server directly.
//   - Websites go through a Cloudflare Tunnel (cloudflared connects *out* to Cloudflare).
//   - SSH and admin access go through Tailscale (a private network of your own devices).
//   - The provider's firewall then blocks every incoming connection.
//
// The guide's text lives in the dashboard (web/screens/private.js). Here we keep
// what the server knows: which steps are done, and the checks we can run ourselves.
import { getSetting, setSetting } from "../../lib/settings.ts";
import { config } from "../../lib/config.ts";
import { syncRoutes } from "../../deploy/route.ts";
import { CHECKS, type StepResult } from "./checks.ts";

type Saved = { at: string; ok: boolean; message: string };
type State = { tunnel: boolean; steps: Record<string, Saved> };

const KEY = "private";
const load = () => getSetting<State>(KEY, { tunnel: false, steps: {} });
const now = () => new Date().toISOString();

// Is the server behind a Cloudflare Tunnel? Then Caddy must not redirect http → https:
// the tunnel talks plain http to Caddy, and Cloudflare already serves HTTPS to visitors.
export const behindTunnel = () => load().tunnel;

export function privateStatus() {
  const s = load();
  return {
    tunnel: s.tunnel,
    steps: s.steps,
    checkable: Object.keys(CHECKS),
    domain: config.baseDomain,
    ownDomain: config.baseDomain !== config.nipDomain,
    dashboard: config.dashboardHost,
    publicIp: config.publicIp,
  };
}

// Run the check for one step and remember the answer.
export async function checkStep(id: string): Promise<StepResult> {
  const check = CHECKS[id];
  if (!check) throw new Error("This step can't be checked automatically. Tick it when you've done it.");
  const r = await check().catch((e) => ({ ok: false, message: (e as Error).message }));
  const s = load();
  s.steps[id] = { at: now(), ...r };
  setSetting(KEY, s);
  return r;
}

// Steps we can't check: the user ticks them.
export function markStep(id: string, done: boolean) {
  const s = load();
  if (done) s.steps[id] = { at: now(), ok: true, message: "" };
  else delete s.steps[id];
  setSetting(KEY, s);
}

export async function setTunnel(on: boolean) {
  const s = load();
  const before = s.tunnel;
  s.tunnel = on;
  setSetting(KEY, s);
  try { await syncRoutes(); }
  catch (e) { s.tunnel = before; setSetting(KEY, s); throw e; } // Caddy refused: keep the old way
}
