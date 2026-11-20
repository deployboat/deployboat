// What AI agents need to know. Two versions of the same guide:
//  - agentGuide: just the rules (served to the MCP `setup_guide` tool)
//  - agentPrompt: rules + how to connect, for pasting into a chat.
//    It contains <TOKEN>; the dashboard swaps in a fresh agent token.
import type { Context } from "hono";
import { config } from "../lib/config.ts";

const RULES = `How apps must be written for Deploy Boat:
- The app must listen on the port in the PORT environment variable.
- Don't add a Dockerfile or deploy config. The stack is detected automatically
  (static HTML, Node, Python, Go, PHP, …). A Node app needs a "start" script.
- Every deploy starts a fresh container: files the app writes are LOST on the next deploy,
  except in the data folder. Save files, uploads and SQLite databases in the folder in
  the DATA_DIR environment variable (it's /data). Example: path.join(process.env.DATA_DIR, "app.db").
- No database or file storage by default. Add them only if the app needs them:
  - PostgreSQL database: deploy with services ["database"] (MCP deploy tool),
    or: deployboat deploy --with database   (later: deployboat add database).
    The app then gets DATABASE_URL.
  - File storage (S3-compatible): services ["storage"], or --with storage.
    The app gets S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
    Set forcePathStyle: true in the S3 client. Files are public at S3_PUBLIC_URL + "/" + key.
  - Email: a person connects the app's email provider once in the dashboard (app → Email).
    After that, services ["email"] / --with email works. The app gets SMTP_URL (and SMTP_HOST,
    SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE). Use SMTP_FROM as the sender.
- Don't use external database or storage services, and never hard-code secrets.
  If the app needs an API key, ask the user for it and save it as a variable
  (set_env tool, or: deployboat env set KEY=value).
- If a deploy fails, read the error and the log, fix the code, and deploy again.
- If the app crashes after deploying, read its logs (get_logs tool, or: deployboat logs).
- Keep the .deployboat.json file. It remembers which app the folder belongs to.`;

export const agentGuide = (c: Context) => c.text(RULES + "\n");

export const agentPrompt = (c: Context) => c.text(`You can publish this project to my Deploy Boat server.

To publish it (or publish an update), run this in the project's root folder:

  npx deployboat deploy --json --server https://${config.dashboardHost} --token <TOKEN>

It prints one line of JSON. On success it has "url": show that URL to me.
On failure it has "error" and the last lines of the build "log".

Other commands (same --server and --token):
  npx deployboat logs              the app's recent output
  npx deployboat env set KEY=value add a secret or setting (restarts the app)
  npx deployboat status            is it running, and where
  npx deployboat add database      give the app a PostgreSQL database (or: add storage, add email)

${RULES}
`);
