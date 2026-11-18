<h1 align="center">Deploy Boat</h1>

<p align="center">
  <b>Self-hosted app hosting for indie developers and AI builders.</b><br>
  Ship anything you (or your AI) built to your own server. One command, or just say <i>"publish it"</i>.
</p>

<p align="center">
  <a href="#install-in-one-line">Install</a> ·
  <a href="#publish-with-your-ai-agent">AI agents & MCP</a> ·
  <a href="#everything-your-app-needs-built-in">Features</a> ·
  <a href="#who-its-for">Who it's for</a> ·
  <a href="#faq">FAQ</a>
</p>

---

You built something with Claude, Cursor or ChatGPT. Now it needs to live on the internet,
with a database, file uploads and HTTPS, without a monthly bill that grows with every
side project.

Deploy Boat turns a cheap VPS into your own little Vercel / Heroku / Railway.
Install it once, then publish every project from your terminal, from Git, or by
asking your AI agent. No Docker files, no YAML, no settings page to learn first.

**It just works.** That's the whole idea.

> Early days: it works on a real server today, but expect rough edges and fast changes.

## Who it's for

- **Indie hackers and solo developers** shipping lots of small apps and side projects
- **AI builders and "vibe coders"** who want their agent to deploy, not just write code
- **Non-technical makers** who can rent a server but don't want to become sysadmins
- Anyone tired of paying per app on hosted platforms

If you have a team of 50 and a Kubernetes cluster, this isn't for you, and that's on purpose.

## Install in one line

Rent any Ubuntu or Debian server (a $5 VPS is plenty), then run:

```sh
curl -fsSL https://raw.githubusercontent.com/osbulbul/deploy-boat/main/install.sh | sudo bash
```

A few minutes later you get a dashboard link. Your server is already secured:
firewall, brute-force protection, automatic security updates, HTTPS.

## Publish with your AI agent

Deploy Boat is built for AI-assisted development. Your agent can publish, read logs,
fix errors and redeploy on its own.

**Option 1: MCP server (recommended).** Connect Deploy Boat as a tool in
Claude Code, Claude Desktop, Cursor, Windsurf or any MCP-compatible agent:

```sh
claude mcp add deployboat -e DEPLOYBOAT_URL=<your-dashboard> -e DEPLOYBOAT_TOKEN=<agent-token> -- npx -y deployboat mcp
```

Then, in any project, just say *"publish it"*. Your agent gets these tools:

| Tool | What the agent can do |
|---|---|
| `deploy` | Publish or update the project and get the live URL |
| `add_service` | Give the app a database or file storage, only if it needs one |
| `get_logs` | Read the app's output to debug a crash |
| `set_env` / `unset_env` | Add API keys and settings without putting them in code |
| `app_status`, `list_apps` | See what's running and where |
| `setup_guide` | Learn the rules for building apps that deploy cleanly |

**Option 2: paste a message.** The dashboard gives you a ready-made prompt for any
agent that can run terminal commands. Paste it, say *"publish it"*, done.

**Safe by default.** Agents use **agent tokens**: they can deploy and read logs,
but can't delete apps, touch the server or read your secrets. Revoke one anytime.

The dashboard fills in all of this for you: **New app → With my AI agent**.

## Publish from your terminal or Git

```sh
npx deployboat login <your-dashboard> <token>   # once
npx deployboat deploy                          # in any project folder
```

```
✓ Live: https://my-app.95.216.148.189.nip.io
```

Or connect a **GitHub, GitLab or any Git repo**, public or private, and redeploy
with one click.

Deploy Boat figures out what you built: plain HTML, React, Vite, Next.js, Node,
Python, Go, PHP and more. If you already have a Dockerfile, it uses that.

## Everything your app needs, built in

No extra accounts, no extra bills. Add what an app needs with one click, or let your AI agent add it.

- **PostgreSQL database**, ready as `DATABASE_URL`
- **File storage** (S3-compatible) with public links, for uploads and images
- **HTTPS** on a free address, or on **your own domain**
- **Password protection** and private share links for previews
- **Cron jobs** that call a URL or run a command on a schedule, with retries
- **Versions and one-click rollback**
- **Live logs** and environment variables

## A server that looks after itself

You shouldn't need to know Linux to run a server safely.

**Server Doctor** checks your server every 10 minutes and explains problems in
plain words: disk getting full, security updates waiting, a certificate failing,
an app that keeps crashing. Most problems have a **Fix it** button that tells you
exactly what it will do first.

The **System** page shows CPU, memory, disk and every process on the server,
labelled by which app it belongs to.

## Deploy Boat vs. hosted platforms

| | Deploy Boat | Vercel / Heroku / Railway |
|---|---|---|
| Cost | One server, unlimited apps | Per app, per seat, per usage |
| Your data | On your server | On theirs |
| Database & storage | Built in, one click per app | Extra services, extra bills |
| AI agent deploys | Built in (MCP + CLI) | Varies |
| Setup | One command | Account + config per project |

And compared to self-hosted tools like Coolify or Dokku: fewer settings, plain-language
dashboard, an AI-first workflow, and a server doctor that fixes things for you.

## FAQ

**Do I need to know Docker?** No. Deploy Boat uses it under the hood so you don't have to.

**Do I need a domain?** No. Every app gets a free HTTPS address. Add your own domain anytime.

**What server do I need?** Ubuntu 22.04 / 24.04 or Debian 12. 1–2 GB of memory is enough to start.

**Is it free?** Yes, open source under the MIT license. You only pay for your server.

**Can I host apps my AI wrote?** That's exactly what it's for.

## Feedback

I'm not taking pull requests, but feedback helps a lot. If something broke,
confused you, or felt harder than it should,
[open an issue](https://github.com/osbulbul/deploy-boat/issues).
You're welcome to fork it and make it your own.

## License

[MIT](LICENSE)
