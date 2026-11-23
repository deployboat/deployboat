// Server Doctor → "Make your server private": a checklist to follow one step at a time.
//
// Each step says what to do and why. Steps the server can check have a "Check" button;
// the others have "Mark as done". Progress is saved on the server, so you can stop and
// come back later (or continue from another computer).
import { api, esc, icon, toast, copy, timeAgo } from "../app.js";
import { ask } from "../dialog.js";

// The guide. `check: true` = the server checks it (see server/doctor/private/checks.ts).
// In `text`, {ip}, {domain}, {dashboard} and {tsip} are filled in for you.
const PARTS = [
  {
    title: "Before you start",
    steps: [
      { id: "console", title: "Make sure you can open your server's web console",
        text: "In your provider's panel (Hetzner, DigitalOcean, …) open the server's Console. It works even when the firewall blocks everything, so it's your way back in if a step goes wrong.\n\nLog in there once now to be sure you know the password." },
    ],
  },
  {
    title: "SSH through Tailscale",
    note: "Tailscale is a private network of your own devices. Only they can reach the server.",
    steps: [
      { id: "tailscale-devices", title: "Install Tailscale on your computer and phone",
        text: "Create a free account and install the app on the devices you use to manage the server.",
        link: ["Download Tailscale", "https://tailscale.com/download"] },
      { id: "tailscale-server", check: true, title: "Install Tailscale on this server",
        text: "SSH into the server as usual and run these two commands. The second one prints a link: open it and log in with the same account.",
        commands: ["curl -fsSL https://tailscale.com/install.sh | sh", "sudo tailscale up"] },
      { id: "ssh-tailscale", title: "Connect to SSH over Tailscale",
        text: "From your computer, connect to the server's Tailscale address instead of its public IP. Keep this window open until the end of the guide.",
        commands: ["ssh root@{tsip}"] },
    ],
  },
  {
    title: "Websites through a Cloudflare Tunnel",
    note: "The tunnel connects out to Cloudflare, so visitors never reach the server directly. Cloudflare also filters known attacks.",
    steps: [
      { id: "cf-domain", check: true, title: "Use Cloudflare for your domain's DNS",
        text: "Add {domain} to a free Cloudflare account and change the nameservers at your registrar to the two Cloudflare gives you. This can take up to an hour." ,
        link: ["Open Cloudflare", "https://dash.cloudflare.com/"] },
      { id: "cf-tunnel", check: true, title: "Create a tunnel and install it on this server",
        text: "In Cloudflare go to Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Name it (for example deployboat), pick Debian, and run the install command it shows on the server. It looks like this:",
        commands: ["sudo cloudflared service install <your token>"],
        link: ["Open Zero Trust", "https://one.dash.cloudflare.com/"] },
      { id: "tunnel-mode", check: true, action: true, title: "Tell Deploy Boat it's behind a tunnel",
        text: "The tunnel sends plain http to the server, and Cloudflare handles HTTPS. This stops Deploy Boat from redirecting those requests back to https, which would loop forever. Your sites keep working while it's on." },
      { id: "cf-addresses", check: true, title: "Send your addresses through the tunnel",
        text: "In the tunnel's Public Hostname tab add these, each with Service type HTTP and URL localhost:80:\n\n• *.{domain} (all your apps and the dashboard)\n• each app's own domain, like myshop.com (that domain must be on Cloudflare too)\n\nThen in Cloudflare DNS for {domain}: delete the old A records that point to {ip}, and add a CNAME named * pointing to <tunnel id>.cfargotunnel.com with the orange cloud on (the tunnel page shows the id)." },
    ],
  },
  {
    title: "Close the doors",
    steps: [
      { id: "firewall", title: "Block everything in your provider's firewall",
        text: "In your provider's panel create a firewall with no inbound rules at all and attach it to this server. Tailscale and the tunnel keep working because they only connect out.\n\nDon't close your SSH window yet." },
      { id: "test-closed", title: "Test that the server is closed",
        text: "On your computer, turn Tailscale off and run the commands below. All three should time out. Then turn Tailscale on again.",
        commands: ["nc -vz -w 5 {ip} 22", "nc -vz -w 5 {ip} 80", "nc -vz -w 5 {ip} 443"] },
      { id: "test-open", title: "Test that everything still works",
        text: "• Open your sites on your phone with Wi-Fi off.\n• Open a new SSH session to {tsip}.\n• Open the dashboard at https://{dashboard}.\n\nIf all three work, you're done." },
    ],
  },
];

// How many steps there are (Server Doctor shows "3 of 11 done").
export const STEP_COUNT = PARTS.flatMap((p) => p.steps).length;

export async function privateScreen(view) {
  let s = await api("/api/doctor/private");
  const busy = new Set();

  const all = PARTS.flatMap((p) => p.steps);
  const isDone = (id) => !!s.steps[id]?.ok;
  const fill = (t) => esc(t)
    .replaceAll("{ip}", esc(s.publicIp)).replaceAll("{domain}", esc(s.ownDomain ? s.domain : "your domain"))
    .replaceAll("{dashboard}", esc(s.dashboard)).replaceAll("{tsip}", esc(tsIp() ?? "<tailscale address>"));
  // The Tailscale address, once the "Install Tailscale on this server" check found it.
  const tsIp = () => s.steps["tailscale-server"]?.message.match(/100\.\d+\.\d+\.\d+/)?.[0];

  function draw() {
    const done = all.filter((st) => isDone(st.id)).length;
    const next = all.find((st) => !isDone(st.id))?.id;
    let n = 0;
    view.innerHTML = `
      <div class="head">
        <a class="linkbtn pv-back" href="#/doctor">${icon("back")} Server Doctor</a>
        <h1>Make your server private</h1>
        <p class="muted">Take the server off the public internet. Afterwards only Cloudflare (for your sites) and your own devices (for SSH) can reach it.</p>
      </div>
      <div class="card pv-progress">
        <div class="row spread"><b>${done === all.length ? "All done. Your server is private 🎉" : `${done} of ${all.length} steps done`}</b>
          <span class="muted">About 30 minutes</span></div>
        <div class="pv-bar"><span style="width:${(done / all.length) * 100}%"></span></div>
      </div>
      ${PARTS.map((p) => `
        <h3 class="doc-h">${esc(p.title)}</h3>
        ${p.note ? `<p class="note pv-note">${esc(p.note)}</p>` : ""}
        <div class="card pv-list">${p.steps.map((st) => step(st, ++n, st.id === next)).join("")}</div>`).join("")}
      <div class="card pad pv-undo">
        <b>Changed your mind?</b>
        <p class="muted">Remove the provider firewall (or allow ports 22, 80 and 443), put the A records back to ${esc(s.publicIp)}, and turn tunnel mode off in step ${all.findIndex((x) => x.id === "tunnel-mode") + 1}.</p>
      </div>`;
    wire();
  }

  function step(st, n, isNext) {
    const r = s.steps[st.id], done = !!r?.ok;
    const open = !done || isNext;
    return `
      <div class="pv-step ${done ? "done" : ""} ${isNext ? "next" : ""}">
        <span class="pv-num">${done ? icon("check") : n}</span>
        <div class="pv-body">
          <b>${esc(st.title)}</b>
          ${open ? `
            <div class="pv-text">${fill(st.text).split("\n\n").map((t) => `<p>${t.replace(/\n/g, "<br>")}</p>`).join("")}</div>
            ${st.commands ? st.commands.map((c) => `<div class="pv-cmd"><code>${fill(c)}</code>
              <button class="btn ghost" data-copy="${esc(c)}" title="Copy">${icon("copy")}</button></div>`).join("") : ""}
            ${st.link ? `<a class="linkbtn pv-link" href="${esc(st.link[1])}" target="_blank" rel="noopener">${esc(st.link[0])} ${icon("external")}</a>` : ""}` : ""}
          ${r?.message ? `<p class="pv-result ${r.ok ? "ok" : "bad"}">${icon(r.ok ? "check" : "alert")} ${esc(r.message)}
            <span class="muted">· ${timeAgo(r.at.replace("T", " ").slice(0, 19))}</span></p>` : ""}
        </div>
        <div class="pv-acts">${actions(st, done)}</div>
      </div>`;
  }

  function actions(st, done) {
    if (busy.has(st.id)) return `<button class="btn" disabled><span class="spinner sm"></span> Checking…</button>`;
    if (st.action) return s.tunnel
      ? `<button class="btn" data-tunnel="off">Turn off</button>`
      : `<button class="btn primary" data-tunnel="on">Turn on</button>`;
    if (st.check) return `<button class="btn ${done ? "" : "primary"}" data-check="${st.id}">${done ? "Check again" : "Check"}</button>`;
    return done
      ? `<button class="btn ghost" data-mark="${st.id}" data-done="0" title="Mark as not done">Undo</button>`
      : `<button class="btn" data-mark="${st.id}" data-done="1">${icon("check")} Mark as done</button>`;
  }

  function wire() {
    view.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy.replace("{tsip}", tsIp() ?? "").replace("{ip}", s.publicIp))));
    view.querySelectorAll("[data-check]").forEach((b) => (b.onclick = () => check(b.dataset.check)));
    view.querySelectorAll("[data-mark]").forEach((b) => (b.onclick = async () => {
      try { s = await api(`/api/doctor/private/${b.dataset.mark}`, { method: "PUT", body: { done: b.dataset.done === "1" } }); }
      catch (err) { toast(err.message, "error"); }
      draw();
    }));
    view.querySelectorAll("[data-tunnel]").forEach((b) => (b.onclick = async () => {
      const on = b.dataset.tunnel === "on";
      if (!on && !(await ask({ title: "Turn tunnel mode off?", text: "Only do this if visitors reach the server directly again (ports 80 and 443 open, A records pointing to the server). Behind a tunnel your sites would stop loading.", ok: "Turn off", danger: true }))) return;
      b.disabled = true;
      try {
        s = await api("/api/doctor/private-tunnel", { method: "PUT", body: { on } });
        await check("tunnel-mode");
        toast(on ? "Tunnel mode is on" : "Tunnel mode is off");
      } catch (err) { toast(err.message, "error"); draw(); }
    }));
  }

  async function check(id) {
    busy.add(id); draw();
    try {
      const r = await api(`/api/doctor/private/${id}/check`, { method: "POST" });
      s.steps[id] = { ...r, at: new Date().toISOString() };
      if (!r.ok) toast("Not done yet. See the note under the step.", "error");
    } catch (err) { toast(err.message, "error"); }
    busy.delete(id); draw();
  }

  draw();
}
