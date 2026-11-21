// An app's runtime logs, as separate lines with a time, a level and where they came from.
// Used by the Logs page, so it can show errors or debug lines on their own.
//
// Docker keeps everything the app prints. We ask for it with timestamps, and keep
// stdout and stderr apart. The level is guessed from the line itself:
//   - JSON logs (pino, winston, structlog…): their "level" field
//   - text logs: a word like ERROR, WARN, DEBUG near the start
//   - stack trace lines ("    at foo()", "  File …") get the level of the line before
import { spawn } from "node:child_process";
import { containerName } from "../deploy/network.ts";

export type Level = "error" | "warn" | "info" | "debug";
export type LogLine = { time: string; stream: "out" | "err"; level: Level; text: string };

// docker logs --timestamps, split into stdout and stderr lines.
function dockerLogs(app: string, lines: number, since?: string): Promise<{ stream: "out" | "err"; raw: string }[]> {
  return new Promise((resolve) => {
    const args = ["logs", "--timestamps", "--tail", String(lines)];
    if (since) args.push("--since", since);
    const child = spawn("docker", [...args, containerName(app)]);
    const out: string[] = [], err: string[] = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const split = (chunks: string[], stream: "out" | "err") =>
        chunks.join("").split("\n").filter(Boolean).map((raw) => ({ stream, raw }));
      // "No such container" also arrives on stderr: drop Docker's own messages.
      resolve([...split(out, "out"), ...split(err, "err").filter((l) => !l.raw.startsWith("Error response from daemon"))]);
    });
  });
}

// pino uses numbers: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
function levelFromJson(v: unknown): Level | null {
  if (typeof v === "number") return v >= 50 ? "error" : v >= 40 ? "warn" : v >= 30 ? "info" : "debug";
  if (typeof v === "string") return levelFromWord(v);
  return null;
}

function levelFromWord(w: string): Level | null {
  w = w.toLowerCase();
  if (["error", "err", "fatal", "critical", "crit", "panic", "emerg", "alert", "severe"].includes(w)) return "error";
  if (["warn", "warning"].includes(w)) return "warn";
  if (["info", "notice", "log"].includes(w)) return "info";
  if (["debug", "trace", "verbose", "silly", "fine"].includes(w)) return "debug";
  return null;
}

const WORD = /\b(ERROR|ERR|FATAL|CRITICAL|PANIC|WARN|WARNING|INFO|NOTICE|DEBUG|TRACE|VERBOSE)\b/i;
const CRASH = /^(Traceback \(most recent call last\)|Uncaught|Unhandled|panic:|[A-Z]\w*(Error|Exception)\b)/;
const CONTINUES = /^(\s+at\s|\s+File "|\s+\^|\s{4,}\S|\s*\.\.\. \d+ more|Caused by:)/;

// Guess one line's level. `prev` is the level of the line before (for stack traces).
export function levelOf(text: string, prev: Level | null): { level: Level; text: string } {
  if (text.startsWith("{")) {
    try {
      const j = JSON.parse(text);
      const level = levelFromJson(j.level ?? j.lvl ?? j.severity ?? j.levelname) ?? "info";
      // Show the message first, then the other fields as key=value. Time and level have
      // their own columns; pid and hostname are the same on every line.
      const { msg, message, event, level: _l, lvl, severity, levelname, time, timestamp, pid, hostname, ...rest } = j;
      const main = msg ?? message ?? event;
      if (typeof main !== "string") return { level, text };
      const extra = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
      return { level, text: extra ? `${main}  ${extra}` : main };
    } catch { /* not JSON after all */ }
  }
  if (prev && CONTINUES.test(text)) return { level: prev, text };
  if (CRASH.test(text)) return { level: "error", text };
  // Only look near the start, so "0 errors" in a sentence doesn't count.
  const word = text.slice(0, 60).match(WORD);
  return { level: (word && levelFromWord(word[1])) ?? "info", text };
}

export async function logLines(app: string, lines = 500, since?: string): Promise<LogLine[]> {
  const raw = await dockerLogs(app, lines, since);
  // Each line starts with an RFC 3339 time, which sorts as text; merge the two streams by it.
  const parsed = raw.map(({ stream, raw }) => {
    const space = raw.indexOf(" ");
    return { stream, time: raw.slice(0, space), text: raw.slice(space + 1) };
  }).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  let prev: Level | null = null;
  return parsed.map(({ stream, time, text }) => {
    const { level, text: shown } = levelOf(text, prev);
    prev = level;
    return { time, stream, level, text: shown };
  });
}
