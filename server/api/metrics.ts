// History for charts. /api/metrics/server?range=24h, /api/metrics/apps/<name>?range=24h
import { Hono } from "hono";
import { series, uptime, RANGES, type Range } from "../monitor/index.ts";

export const metrics = new Hono();

const rangeOf = (r?: string): Range => (r && r in RANGES ? (r as Range) : "24h");

metrics.get("/server", (c) => {
  const range = rangeOf(c.req.query("range"));
  return c.json({ range, cpu: series("cpu", range), mem: series("mem", range), disk: series("disk", range) });
});

metrics.get("/apps/:name", (c) => {
  const app = c.req.param("name"), range = rangeOf(c.req.query("range"));
  return c.json({
    range,
    uptime: uptime(app, range),
    ms: series(`app:${app}:ms`, range),
    cpu: series(`app:${app}:cpu`, range),
    mem: series(`app:${app}:mem`, range),
  });
});
