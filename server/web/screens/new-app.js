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

// A code box with a copy button.
const codeBox = (text) => `<div class="code"><pre>${esc(text)}</pre><button class="btn" data-copy>${icon("copy")} Copy</button></div>`;
const wireCopy = (el, text) => el.querySelectorAll("[data-copy]").forEach((b, i) => (b.onclick = () => copy(Array.isArray(text) ? text[i] : text)));

async function local(pane) {
  const s = await api("/api/settings");
  const login = `npx deployboat login ${s.dashboard} ${s.token}`;
  const deploy = "npx deployboat deploy";
  pane.innerHTML = `
    <ol class="steps">
      <li><b>Connect your computer</b> (once)${codeBox(login)}</li>
      <li><b>Open your project folder and publish</b>${codeBox(deploy)}</li>
    </ol>
    <p class="note">You need Node.js. Run the same command again to publish updates.</p>`;
  wireCopy(pane, [login, deploy]);
}

async function ai(pane) {
  const prompt = await api("/api/agent-prompt");
  pane.innerHTML = `
    <p class="muted" style="margin-bottom:10px">Paste this into Claude Code, Cursor, Codex or any agent that can run commands. Then say <b>"publish it"</b>.</p>
    ${codeBox(prompt)}
    <p class="note">${icon("lock")} This message contains your server token. Only paste it into tools you trust.</p>`;
  wireCopy(pane, prompt);
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
    } catch (err) { toast(err.message); btn.disabled = false; }
  };
}
