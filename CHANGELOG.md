# Changelog

What changed in each version of Deploy Boat, in plain words.
Each `## x.y.z` section below becomes the notes of that GitHub Release (see `release.sh`).

To update a server: `curl -fsSL deployboat.github.io/install.sh | sudo bash`, or **Doctor → Update now** in the dashboard.
To install a specific version (or go back to one): add `-s -- --version v0.5.0`.

## Unreleased

- **Make your server private** (Server Doctor). A step-by-step checklist that takes the server off the public internet: SSH through Tailscale, websites through a Cloudflare Tunnel, and every incoming port closed at your provider. Steps the server can verify have a Check button (Tailscale running, domain on Cloudflare, cloudflared running, every address answering through Cloudflare); the others you tick off. Progress is saved. Includes a "tunnel mode" switch so Caddy doesn't redirect the tunnel's plain-http requests in a loop.
- Fixed: opening a fix in Server Doctor's "Good to know" list squeezed the details into a narrow column.
- **Persistent storage on the app's Overview.** `/data` is always kept; click the edit button to add more folders (like `/app/uploads`). They survive deploys and are backed up too. Replaces the Data folder page.
- **Files page for every app.** Browse everything inside the running app, edit files in a code editor (syntax colors, line numbers, Ctrl+S), and upload (drag and drop), download, rename and delete. Each folder shows whether it's kept across deploys. When the app is stopped, its persistent folders are still there.
- **A new Logs page with tabs:** Runtime (live), Errors, Debug, Deploys (each version's build log) and Cron jobs (each run's output). Each line gets a time and a level (worked out from JSON logs or words like ERROR/WARN, with stack traces kept together). Search with highlights, level filters, pause/resume, jump to latest, wrap, copy and download.
- **Sharing moved to the app's Overview**, next to the details: QR code, links to copy, and public or password protected in a few clicks. The separate Share page is gone.
- **Domains in one table.** The free address is a row like any other: edit it (renames the app) or turn it off once the app has a domain of its own. Your domains can be renamed or removed too. Each row shows its status, with step-by-step DNS help, a countdown to the next check, Check now, and "also add www" when adding.
- **A file browser on the Storage page.** Browse folders, upload (drag and drop works), copy a file's public link, open, and delete files or whole folders, with image previews. Code examples for Node.js and Python, and the connection details tucked away.
- Fixed: files restored from a backup into storage lost their type, so images downloaded instead of showing. They now get the right type from their name.
- **Removed: email for apps.** Apps send email with their own provider (Resend, Postmark…), using an API key saved as a variable. Apps that already had email keep their `SMTP_*` variables, now as normal variables you can change or delete. Alert emails (Settings → Alerts) still work.
- **Pick your database: PostgreSQL, MySQL (MariaDB) or SQLite.** The Database page explains each one. Also from the CLI (`deployboat add mysql`, `--with sqlite`) and for AI agents.
- **A database viewer.** Browse tables page by page, see their structure, and run any SQL (with a check before changes), with results you can download as CSV. It runs as the app's own database user, so it can't touch other apps.
- **Deleting a database or storage no longer freezes the dashboard.** It runs in the background and shows each step. The backup made first only holds the part being deleted, so it's much quicker, and backups compress at low priority so the server stays responsive.
- **A clearer Crons page.** Jobs in a table with their schedule in words, a strip of the last 10 runs, the next run and a Run button; click a row for its history and output. A step-by-step New job form with the full address or command, a live description of the schedule, a time zone picker, and example jobs to start from. Jobs can be duplicated.
- **A clearer Versions page.** What's live now on top (with Pull & redeploy), then a table of versions: status, where each came from (Git push with its commit, CLI upload, redeploy), when and how long the build took, its log (colored, live while building) and Roll back. New deploys record their source, commit and build time.
- **A clearer Variables page.** Your variables in a table with show/hide, copy, inline edit (rename too) and delete, plus search. Paste a whole .env file (with a preview of what's new or replaced) or download one. Names are cleaned up as you type, and several changes restart the app only once. Deploy Boat's own variables are grouped and folded away.
- **Select boxes in the dashboard's own style** everywhere, with search for long lists like time zones. Fixed misaligned fields on the Crons form, and menus that closed by themselves on the Logs page while the log was updating.
- **Our own dialogs instead of the browser's.** Every confirm and name prompt is now a dialog in the dashboard's style, with a clear title, an explanation and a labelled button (red for destructive ones). Deleting an app, a database or storage, or restoring a backup asks you to type the app's name, and the button unlocks when it matches. Messages at the bottom now show a check or, for errors, a red warning that stays longer and can be closed.
- Fixed: "Invalid URL" on the Storage page, and failing backups, deletes and restores of stored files, once an app had storage (the storage server's address was read wrong).
- Settings is one page with tabs (Security, Alerts, Domain), and the dashboard shows its version.

## 0.5.0

The first numbered release. Servers now install releases instead of the newest code on `main`.

### New
- **Releases.** The installer installs the latest release. Pick one with `--version v0.5.0`, or follow `main` with `--edge`. Server Doctor tells you when a new release is out.
- **A data folder for every app.** Files saved in `DATA_DIR` (`/data`) survive deploys and restarts, and are included in backups. Use it for SQLite databases and uploads. The app's new **Data folder** page shows how.
- **Settings has its own menu:** Security (main token and agent tokens), Alerts, and Domain.
- **Apps page:** filter by status, search, sort and group with new dropdowns, and a menu on each app (open, copy address, move to group).
- **Custom domains** for the whole server and the dashboard, with DNS checks that explain exactly what to fix.

### Changed
- **Email is set up per app**, on the app's Email page. The shared provider in Settings is gone. Apps that already had email keep working.
- **Alerts page** is easier to read: destinations as cards, events grouped with a note on when each one is sent.
- **Backups page** shows the last and next backup, whether there's an off-server copy, and where each backup is kept.
- The System page shows "Loading…" until everything is ready, instead of appearing in pieces.

### Fixed
- The Backups page no longer wipes a half-filled form (S3, Google Drive) when it refreshes, and connecting Google Drive no longer stops halfway.
- A restore keeps showing "Restoring…" until it's done.

### Security
- Passwords of password-protected apps are no longer stored, only a hash of them. The dashboard can't show them anymore; choose a new one if you forget it.

### Before you update
- These changes happen once, the first time the new version starts, and are **not undone** if you go back to an older version: the plain app passwords and the shared email provider (with its password) are deleted.

## 0.4.0 and earlier

Before 0.5.0 there were no releases: every install got the newest code. See the [commit history](https://github.com/deployboat/deployboat/commits/main) for what changed.
