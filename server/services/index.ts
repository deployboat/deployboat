// Built-in services an app can add: a database and file storage.
// Nothing is added automatically. The user (dashboard) or their AI agent asks for it.
// Once added, every deploy makes sure it still exists.
//
// To add a service: create a folder with index.ts exporting enabled(), provision(),
// rename() and destroy(), then list it here.
import * as postgres from "./postgres/index.ts";
import * as files from "./files/index.ts";

export const SERVICES = { database: postgres, storage: files };
export type ServiceName = keyof typeof SERVICES;
export const isService = (s: string): s is ServiceName => s in SERVICES;

export const enabledServices = (app: string) =>
  (Object.keys(SERVICES) as ServiceName[]).filter((s) => SERVICES[s].enabled(app));

// Called on every deploy: keep the services this app already has.
export async function provisionServices(app: string, log: (l: string) => void) {
  for (const s of enabledServices(app)) await SERVICES[s].provision(app, log);
}

// Add a service to an app (does nothing if it already has it).
export async function addService(app: string, service: ServiceName, log: (l: string) => void = () => {}) {
  await SERVICES[service].provision(app, log);
}

export async function renameServices(oldApp: string, newApp: string) {
  for (const s of Object.values(SERVICES)) await s.rename(oldApp, newApp);
}

// Remove a service and delete its data.
export async function removeService(app: string, service: ServiceName) {
  await SERVICES[service].destroy(app);
}

export async function removeAllServices(app: string) {
  for (const s of Object.values(SERVICES)) await s.destroy(app);
}
