# files

One shared Garage server (S3-compatible). Each app gets its own bucket, keys and `S3_*` env vars.
Files are public at `https://files.<app>.<domain>/<path>`. Started automatically on the first deploy.
