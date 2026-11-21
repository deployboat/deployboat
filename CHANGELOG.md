# Changelog

What changed in each version of Deploy Boat, in plain words.
Each `## x.y.z` section below becomes the notes of that GitHub Release (see `release.sh`).

To update a server: `curl -fsSL deployboat.github.io/install.sh | sudo bash`, or **Doctor → Update now** in the dashboard.
To install a specific version (or go back to one): add `-s -- --version v0.5.0`.

## Unreleased

- **Persistent storage on the app's Overview.** `/data` is always kept; click the edit button to add more folders (like `/app/uploads`). They survive deploys and are backed up too. Replaces the Data folder page.
- **Files page for every app.** Browse everything inside the running app, edit files in a code editor (syntax colors, line numbers, Ctrl+S), and upload (drag and drop), download, rename and delete. Each folder shows whether it's kept across deploys. When the app is stopped, its persistent folders are still there.
- **A new Logs page with tabs:** Runtime (live), Errors, Debug, Deploys (each version's build log) and Cron jobs (each run's output). Each line gets a time and a level (worked out from JSON logs or words like ERROR/WARN, with stack traces kept together). Search with highlights, level filters, pause/resume, jump to latest, wrap, copy and download.
- **Sharing moved to the app's Overview**, next to the details: QR code, links to copy, and public or password protected in a few clicks. The separate Share page is gone.
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
