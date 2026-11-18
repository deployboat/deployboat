// Only one deploy per app at a time.
const busy = new Set<string>();

export const isBusy = (app: string) => busy.has(app);
export const lock = (app: string) => busy.add(app);
export const unlock = (app: string) => busy.delete(app);
