// What every database type (postgres.ts, mysql.ts, sqlite.ts) provides.
// index.ts picks the right one for each app.

// The answer to a query, ready for the dashboard's table.
export type Result = {
  columns: string[];
  rows: (string | number | null)[][];
  message?: string;    // for statements that don't return rows: "3 rows changed"
  truncated?: boolean; // more rows than we show
};

export type Table = { name: string; rows: number | null }; // rows can be an estimate
export type Column = { name: string; type: string; nullable: boolean; default: string | null; key: boolean };

export type Engine = {
  label: string;                 // "PostgreSQL"
  container: string | null;      // the shared server's container (null for SQLite: no server)
  provision(app: string, log: (l: string) => void): Promise<void>;
  rename(oldApp: string, newApp: string): Promise<void>;
  destroy(app: string): Promise<void>;
  tables(app: string): Promise<Table[]>;
  columns(app: string, table: string): Promise<Column[]>;
  // Rows of one table, a page at a time.
  browse(app: string, table: string, offset: number, limit: number): Promise<Result>;
  // Any SQL. Runs as the app's own database user, so it can't touch other apps.
  query(app: string, sql: string, maxRows: number): Promise<Result>;
  size(app: string): Promise<number | null>; // bytes
  // Backups: write the dump into `dir`, and read it back. SQLite has none (it's in /data).
  dump(app: string, dir: string): Promise<boolean>;
  restore(app: string, dir: string): Promise<void>;
};
