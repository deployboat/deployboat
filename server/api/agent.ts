// The message users paste into their AI agent so it can publish for them.
import type { Context } from "hono";
import { config } from "../lib/config.ts";

export const agentPrompt = (c: Context) => c.text(`You can publish this project to my Deploy Boat server.

To publish it (or publish an update), run this in the project's root folder:

  npx deployboat deploy --server https://${config.dashboardHost} --token ${config.token}

It prints a live URL at the end. Show it to me.

Rules:
- The app must listen on the port in the PORT environment variable.
- Don't add a Dockerfile or deploy config. The stack is detected automatically.
- A PostgreSQL database is ready. Use the DATABASE_URL environment variable.
- File storage (S3-compatible) is ready: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
  Set forcePathStyle: true in the S3 client. Uploaded files are public at S3_PUBLIC_URL + "/" + key.
- Don't use external database or storage services, and don't hard-code secrets.
  If the app needs an API key, ask me to add it in the Deploy Boat dashboard under Variables.
- If the deploy fails, read the error, fix the code, and deploy again.
- Keep the generated .deployboat.json file. It remembers which app this folder belongs to.
`);
