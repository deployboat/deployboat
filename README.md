<h1 align="center">Deploy Boat</h1>

<p align="center">
  <b>Your own server. Your own apps. It just works.</b><br>
  Put any project online with one command, or just ask your AI to do it.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#publish-an-app">Publish</a> ·
  <a href="#whats-inside">What's inside</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

I wanted something like Coolify, but for people who don't want to learn Coolify.
You rent a cheap server, paste one line, and from then on publishing an app is
one command. No YAML, no Dockerfiles, no settings page you have to understand first.

> **Status:** early and moving fast. It works on a real server today, but expect rough edges.

## Install

You need a fresh **Ubuntu 22.04 / 24.04** or **Debian 12** server. Any $5 VPS is fine.

```sh
curl -fsSL https://raw.githubusercontent.com/osbulbul/deploy-boat/main/install.sh | sudo bash
```

That's it. At the end it prints your dashboard address and a login command.
Your apps live at `https://<app>.<your-ip>.nip.io`, with HTTPS already working.

## Publish an app

From any project folder on your computer:

```sh
npx deployboat login <dashboard-url> <token>   # once
npx deployboat deploy                          # every time
```

```
→ Uploading my-app…
  → Building (stack is detected automatically)…
  → Creating your database…
  → Starting…

✓ Live: https://my-app.95.216.148.189.nip.io
```

Deploy Boat figures out what you built: a plain HTML site, React, Next.js, Node,
Python, Go, PHP… If it has a Dockerfile, that's used instead.

## Three things it's good at

### Easy, fast deploys for AI projects

Built something with Claude, Cursor or ChatGPT? Tell it *"publish it"*.
The agent runs one command and hands you a live link. Every app already has a
database and file storage, so the agent doesn't go looking for external services.
*(A ready-made prompt to paste into your agent and an MCP server are coming next.)*

### Easy app management

A clean dashboard for everything you've published:

- see what's live, building or broken
- read live logs
- roll back to an earlier version with one click
- add environment variables (the app restarts by itself)
- rename an app, and its address, database and storage follow along
- see your database tables and storage usage

### Easy server management

You shouldn't need to know Linux to run a server safely. The installer sets up
a firewall, brute-force protection, automatic security updates, swap and log
limits. The **Server** page shows CPU, memory, disk and every running service
in plain words, with a restart button next to each.

## What's inside

Every app gets these on its first deploy. No setup, nothing to click.

| | What you get | Your app sees |
|---|---|---|
| **Database** | PostgreSQL, a separate database per app | `DATABASE_URL` |
| **File storage** | S3-compatible, public link for each file | `S3_*` and `AWS_*` |
| **HTTPS** | Automatic certificates | — |
| **Versions** | Every deploy is kept, roll back anytime | — |

Coming: login/auth for your apps, email, cron jobs, backups, custom domains,
GitHub auto-deploys.

## How it works

```
your folder ──► deployboat deploy ──► server
                                       │
                         build (Railpack) → start (Docker) → route (Caddy)
                                       │
                        Postgres · Garage (files) · your apps
```

Small on purpose. Two parts, one language (TypeScript), no build step:

```
server/
  api/        HTTP routes
  deploy/     build → services → start → route, one file each
  services/   postgres/, files/ … one folder per built-in service
  web/        the dashboard (plain HTML/CSS/JS)
cli/          the deployboat command
install.sh    the installer
```

If you can read a bit of JavaScript, you can follow a deploy from start to finish
in about ten minutes. Start at `server/deploy/index.ts`.

## Contributing

Issues and pull requests are very welcome, especially from people who are new
to this kind of project. Good first things:

- try it on your own server and tell me what confused you
- make an error message friendlier
- improve a dashboard screen
- add a built-in service (copy `server/services/postgres/` and go)

Keep it simple. If a change needs a long explanation, it's probably too clever.

## License

[MIT](LICENSE)
