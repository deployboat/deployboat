// Entry point. Starts the HTTP server and syncs Caddy routes.
import { serve } from "@hono/node-server";
import { app } from "./api/routes.ts";
import { config } from "./lib/config.ts";
import { syncRoutes } from "./deploy/route.ts";
import { startScheduler } from "./crons/index.ts";
import { startDoctor } from "./doctor/index.ts";
import { startBackups } from "./backups/index.ts";

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" });
console.log(`Deploy Boat running on :${config.port}`);
console.log(`Dashboard: https://${config.dashboardHost}`);
console.log("Token:     sudo cat /var/lib/deployboat/token");

startScheduler();
startDoctor();
startBackups();

// Caddy may still be starting, so keep trying for a minute.
for (let i = 1; i <= 30; i++) {
  try { await syncRoutes(); console.log("Caddy routes synced"); break; }
  catch (e) {
    if (i === 30) console.error("Caddy sync failed:", (e as Error).message);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
