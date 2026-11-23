# doctor

Server Doctor: checks the server every 10 minutes and offers safe fixes.

- `checks/` — one file per check (`check()` and an optional `fix`)
- `index.ts` — runs checks, runs fixes one at a time, keeps a history

To add a check: copy a file in `checks/`, then add it to `CHECKS` in `index.ts`.
- `private/`: the "Make your server private" checklist (progress, checks, tunnel mode). See its README.
