// Entry point. Starts the HTTP server and syncs Caddy routes.
import { serve } from "@hono/node-server";
import { app } from "./api/routes.ts";
import { config } from "./lib/config.ts";
import { syncRoutes } from "./deploy/route.ts";

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" });
console.log(`Deploy Boat running on :${config.port}`);
console.log(`Dashboard: https://${config.dashboardHost}`);
console.log(`Token:     ${config.token}`);

syncRoutes().catch((e) => console.error("Caddy sync failed:", e.message));
