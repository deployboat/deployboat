# doctor/private

"Make your server private" (Server Doctor → Make your server private): a checklist that moves
the server off the public internet.

- Websites reach the server only through a **Cloudflare Tunnel** (`cloudflared`).
- SSH and the CLI reach it only through **Tailscale**.
- The provider's firewall blocks every incoming connection.

Files:

- `index.ts`: saved progress (`private` setting), and tunnel mode (`behindTunnel()`).
  Tunnel mode turns off Caddy's http → https redirect, because the tunnel sends plain http to Caddy.
- `checks.ts`: the steps the server can check by itself (Tailscale up, domain on Cloudflare,
  cloudflared running, every address answering through Cloudflare).

The guide's words and order live in `web/screens/private.js`. To add a checkable step, add a
function to `CHECKS` here and use the same id in that file.
