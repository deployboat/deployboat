// "New app" window: Local (CLI), AI agent, or Git.
import { api, esc, icon, toast, copy } from "../app.js";

export function openNewApp() {
  const modal = document.createElement("div");
  modal.className = "overlay";
  modal.innerHTML = `
    <div class="modal card" role="dialog" aria-label="New app">
      <div class="row spread"><h2>New app</h2><button class="btn" data-close>✕</button></div>
      <div class="choices">
        <button class="choice" data-pick="local">${icon("term")}<b>From my computer</b><span>Run one command in your project folder</span></button>
        <button class="choice" data-pick="ai">${icon("sparkle")}<b>With my AI agent</b><span>Paste a message, then say "publish it"</span></button>
        <button class="choice" data-pick="git">${icon("git")}<b>From Git</b><span>GitHub, GitLab or any Git repo</span></button>
      </div>
      <div id="pane"></div>
    </div>`;
  document.body.append(modal);

  const close = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal || e.target.closest("[data-close]")) close(); };
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });

  const pane = modal.querySelector("#pane");
  modal.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
    modal.querySelectorAll("[data-pick]").forEach((x) => x.classList.toggle("on", x === b));
    ({ local, ai, git })[b.dataset.pick](pane, close);
  }));
}

// Step 1 of Local and AI: make a limited agent token. Shows once, then calls `ready(token)`.
function tokenStep(pane, defaultName, ready) {
  pane.innerHTML = `
    <form class="card pad form" id="mk" style="background:var(--bg)">
      <b>First, create a token</b>
      <p class="note" style="margin-top:-6px">It can deploy apps and read their logs, but can't delete anything or change the server.
        You can revoke it any time in Settings.</p>
      <div class="row"><input name="name" value="${esc(defaultName)}" style="flex:1;min-width:180px" required>
        <button class="btn primary">Create token</button></div>
    </form>`;
  pane.querySelector("#mk").onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api("/api/tokens", { method: "POST", body: { name: e.target.name.value } }); ready(r.token); }
    catch (err) { toast(err.message, "error"); }
  };
}

// A code box with a copy button.
const codeBox = (text) => `<div class="code"><pre>${esc(text)}</pre><button class="btn" data-copy>${icon("copy")} Copy</button></div>`;
const wireCopy = (el, text) => el.querySelectorAll("[data-copy]").forEach((b, i) => (b.onclick = () => copy(Array.isArray(text) ? text[i] : text)));

async function local(pane) {
  const s = await api("/api/settings");
  tokenStep(pane, "My computer", (token) => {
    const login = `npx deployboat login ${s.dashboard} ${token}`;
    const deploy = "npx deployboat deploy";
    pane.innerHTML = `
      <ol class="steps">
        <li><b>Connect your computer</b> (once)${codeBox(login)}</li>
        <li><b>Open your project folder and publish</b>${codeBox(deploy)}</li>
      </ol>
      <p class="note">You need Node.js. Run the same command again to publish updates.
        ${icon("lock")} This token is shown only once. Copy it now.</p>`;
    wireCopy(pane, [login, deploy]);
  });
}

// Two ways for an AI agent: paste a message, or connect Deploy Boat as a tool (MCP).
async function ai(pane) {
  const [template, s] = await Promise.all([api("/api/agent-prompt"), api("/api/settings")]);
  tokenStep(pane, "AI agent", (token) => aiReady(pane, template.replaceAll("<TOKEN>", token), s, token));
}

function aiReady(pane, prompt, s, token) {
  const claude = `claude mcp add deployboat -e DEPLOYBOAT_URL=${s.dashboard} -e DEPLOYBOAT_TOKEN=${token} -- npx -y deployboat mcp`;
  const cursor = JSON.stringify({ mcpServers: { deployboat: {
    command: "npx", args: ["-y", "deployboat", "mcp"], env: { DEPLOYBOAT_URL: s.dashboard, DEPLOYBOAT_TOKEN: token },
  } } }, null, 2);

  pane.innerHTML = `
    <div class="tabs" style="margin-bottom:12px">
      <a href="#" data-t="msg" class="on">Paste a message</a>
      <a href="#" data-t="mcp">Connect as a tool (MCP)</a>
    </div>
    <div data-p="msg">
      <p class="muted" style="margin-bottom:10px">Works with any agent that can run commands. Paste this, then say <b>"publish it"</b>.</p>
      ${codeBox(prompt)}
    </div>
    <div data-p="mcp" hidden>
      <p class="muted" style="margin-bottom:10px">Gives your agent Deploy Boat tools: deploy, logs, status, variables. Set it up once, then just say <b>"publish it"</b> in any project.</p>
      <b>Claude Code</b> <span class="note">run in your terminal</span>
      ${codeBox(claude)}
      <div style="margin-top:14px"><b>Cursor, Windsurf, Claude Desktop</b> <span class="note">add to the MCP settings file</span></div>
      ${codeBox(cursor)}
    </div>
    <p class="note" style="margin-top:12px">${icon("lock")} These contain the new token, shown only once. It can deploy and read logs, nothing more. Revoke it in Settings if it leaks.</p>`;

  wireCopy(pane, [prompt, claude, cursor]);
  pane.querySelectorAll("[data-t]").forEach((t) => (t.onclick = (e) => {
    e.preventDefault();
    pane.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === t));
    pane.querySelectorAll("[data-p]").forEach((p) => (p.hidden = p.dataset.p !== t.dataset.t));
  }));
}

function git(pane, close) {
  pane.innerHTML = `
    <form class="form">
      <label>Repository URL<input name="repo" placeholder="https://github.com/you/project" required autocomplete="off"></label>
      <div class="row" style="align-items:flex-start">
        <label style="flex:1">Branch<input name="branch" value="main" required></label>
        <label style="flex:1">App name<input name="name" placeholder="my-app" required pattern="[a-z0-9][a-z0-9\\-]*"></label>
      </div>
      <label class="check"><input type="checkbox" name="private"> This repo is private</label>
      <div id="key" hidden></div>
      <div class="row spread">
        <span class="note">Public repos work right away.</span>
        <button class="btn primary">${icon("rocket")} Deploy</button>
      </div>
    </form>`;
  const form = pane.querySelector("form"), keyBox = pane.querySelector("#key");

  // Suggest an app name from the repo URL.
  form.repo.oninput = () => {
    if (form.name.dataset.touched) return;
    const m = form.repo.value.trim().match(/([^/:]+?)(\.git)?\/?$/);
    form.name.value = (m?.[1] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  };
  form.name.oninput = () => (form.name.dataset.touched = "1");

  form.private.onchange = async () => {
    keyBox.hidden = !form.private.checked;
    if (!form.private.checked) return;
    if (!form.name.value) { keyBox.innerHTML = `<p class="note">Enter the repo URL first.</p>`; return; }
    keyBox.innerHTML = `<div class="loading" style="padding:16px 0"><span class="spinner"></span>Creating a key…</div>`;
    try {
      const { publicKey } = await api("/api/git/key", { method: "POST", body: { name: form.name.value } });
      keyBox.innerHTML = `
        <p style="margin-bottom:8px"><b>Add this deploy key to your repo</b><br>
        <span class="note">GitHub: repo → Settings → Deploy keys → Add deploy key. GitLab: Settings → Repository → Deploy keys.
        Read-only is enough.</span></p>
        ${codeBox(publicKey)}`;
      wireCopy(keyBox, publicKey);
    } catch (err) { keyBox.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button.primary");
    btn.disabled = true;
    try {
      const r = await api("/api/git/deploy", { method: "POST", body: { repo: form.repo.value, branch: form.branch.value, name: form.name.value } });
      toast("Deploy started");
      close();
      location.hash = `#/apps/${encodeURIComponent(r.name)}/versions`;
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
  };
}
