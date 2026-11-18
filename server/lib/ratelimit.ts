// Slow down token guessing: after 5 wrong tries from one address,
// that address waits (1 min, then longer each time, up to 1 hour).
const FREE_TRIES = 5;
const MAX_WAIT = 60 * 60 * 1000;

type Entry = { fails: number; blockedUntil: number; last: number };
const seen = new Map<string, Entry>();

// Seconds this address must still wait, or 0.
export function waitSeconds(ip: string) {
  const e = seen.get(ip);
  return e && e.blockedUntil > Date.now() ? Math.ceil((e.blockedUntil - Date.now()) / 1000) : 0;
}

export function failed(ip: string) {
  const e = seen.get(ip) ?? { fails: 0, blockedUntil: 0, last: 0 };
  if (Date.now() - e.last > MAX_WAIT) e.fails = 0; // forget old mistakes
  e.fails++;
  e.last = Date.now();
  if (e.fails >= FREE_TRIES) e.blockedUntil = Date.now() + Math.min(60_000 * 2 ** (e.fails - FREE_TRIES), MAX_WAIT);
  seen.set(ip, e);
}

export const succeeded = (ip: string) => seen.delete(ip);

// Don't let the map grow forever.
setInterval(() => {
  for (const [ip, e] of seen) if (Date.now() - e.last > MAX_WAIT) seen.delete(ip);
}, 10 * 60 * 1000).unref();
