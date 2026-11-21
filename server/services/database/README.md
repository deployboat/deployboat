# database

The "database" service. An app picks one type when it adds a database:

- `postgres.ts`: PostgreSQL (the default). One shared server, a database + user per app.
- `mysql.ts`: MySQL (MariaDB). One shared server, a database + user per app.
- `sqlite.ts`: a file in the app's `/data` folder. No server.

Every type has the same functions (see `types.ts`): create, rename, delete, list tables,
browse rows, run SQL (as the app's own user), size, and backup dump/restore.
`index.ts` remembers each app's type and picks the right file.
