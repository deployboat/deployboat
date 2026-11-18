# deployboat

The command line for [Deploy Boat](https://github.com/osbulbul/deploy-boat):
publish any project to your own server.

```sh
npx deployboat login <dashboard-url> <token>   # once
npx deployboat deploy                          # in any project folder
```

You get a live HTTPS link. Need a database or file storage? Add `--with database,storage`.

## Commands

```
deployboat deploy [folder]        publish a folder
deployboat add database|storage|email   give the app a database, file storage or email
deployboat apps                   list your apps
deployboat status                 this app's status and address
deployboat logs [--lines 100]     this app's recent output
deployboat env set KEY=value      add a secret or setting
deployboat env unset KEY          remove one
deployboat env list               list them (names only)
```

Add `--json` to any command for machine-readable output.

## For AI agents

Run Deploy Boat as an MCP server so your agent gets `deploy`, `get_logs`,
`set_env` and more as tools:

```sh
claude mcp add deployboat -e DEPLOYBOAT_URL=<dashboard-url> -e DEPLOYBOAT_TOKEN=<token> -- npx -y deployboat mcp
```

The dashboard (New app → With my AI agent) shows this with your details filled in.

Don't have a server yet? See the [install guide](https://github.com/osbulbul/deploy-boat#install).
