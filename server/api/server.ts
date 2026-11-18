// Server page: machine info, usage, and everything running in Docker.
import { Hono } from "hono";
import os from "node:os";
import { readFileSync } from "node:fs";
import { run } from "../lib/shell.ts";
import { config } from "../lib/config.ts";
import { sample } from "../lib/procs.ts";

export const server = new Hono();

const json = (out: string) => out.split("\n").filter(Boolean).map((l) => JSON.parse(l));

server.get("/", async (c) => {
  const osName = readFileSync("/etc/os-release", "utf8").match(/PRETTY_NAME="([^"]+)"/)?.[1] ?? os.type();

  // Disk usage of the main disk, in bytes.
  const df = (await run("df", ["-kP", "/"]).catch(() => "")).split("\n")[1]?.split(/\s+/) ?? [];
  const disk = { total: Number(df[1] ?? 0) * 1024, used: Number(df[2] ?? 0) * 1024 };

  const [containers, stats, dockerVersion] = await Promise.all([
    run("docker", ["ps", "-a", "--format", "{{json .}}"]).then(json).catch(() => []),
    run("docker", ["stats", "--no-stream", "--format", "{{json .}}"]).then(json).catch(() => []),
    run("docker", ["version", "--format", "{{.Server.Version}}"]).catch(() => "?"),
  ]);
  const statsByName = Object.fromEntries(stats.map((s: any) => [s.Name, s]));

  return c.json({
    hostname: os.hostname(),
    os: osName,
    ip: config.publicIp,
    uptime: os.uptime(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "",
    load: os.loadavg(),
    memory: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    disk,
    node: process.version,
    docker: dockerVersion,
    containers: containers.map((ct: any) => ({
      name: ct.Names,
      image: ct.Image,
      state: ct.State,
      status: ct.Status,
      cpu: statsByName[ct.Names]?.CPUPerc ?? "",
      memory: statsByName[ct.Names]?.MemUsage?.split(" / ")[0] ?? "",
    })),
  });
});

// Restart one container (Caddy, Postgres, an app…).
server.post("/containers/:name/restart", async (c) => {
  const name = c.req.param("name");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) return c.json({ error: "Bad name." }, 400);
  try { await run("docker", ["restart", name]); return c.json({ ok: true }); }
  catch { return c.json({ error: `Couldn't restart ${name}.` }, 500); }
});

// Every process on the server, busiest first. ?sort=cpu or ?sort=memory
server.get("/processes", async (c) => {
  const sort = c.req.query("sort") === "memory" ? "memory" : "cpu";
  try { return c.json(await sample(sort)); }
  catch { return c.json({ error: "Couldn't read the process list." }, 500); }
});
