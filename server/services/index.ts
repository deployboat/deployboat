// Built-in services. Each one gives the app some env vars (DATABASE_URL, …).
// To add a service: create a folder with index.ts exporting provision() and rename(), then list it here.
import * as postgres from "./postgres/index.ts";
import * as files from "./files/index.ts";

const services = [postgres, files];

export async function provisionServices(app: string, log: (l: string) => void) {
  for (const s of services) await s.provision(app, log);
}

export async function renameServices(oldApp: string, newApp: string) {
  for (const s of services) await s.rename(oldApp, newApp);
}
