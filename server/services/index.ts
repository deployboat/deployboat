// Built-in services. Each one gives the app some env vars (DATABASE_URL, …).
// To add a service: create a folder with index.ts exporting provision(), then list it here.
import { provision as postgres } from "./postgres/index.ts";

const services = [postgres];

export async function provisionServices(app: string, log: (l: string) => void) {
  for (const provision of services) await provision(app, log);
}
