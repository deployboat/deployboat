// The Share card on the app's Overview: who can see the app (public or password
// protected), with a QR code and the links to send. "Change" opens a small form in the card.
import { api, esc, icon, toast, copy } from "../app.js";
import { ask } from "../dialog.js";

export async function shareCard(el, base) {
  const s = await api(`${base}/share`);
  const isPrivate = s.mode === "password";
  el.innerHTML = `
    <div class="row spread">
      <b>Share</b>
      <span class="pill ${isPrivate ? "warn" : "ok"}">${icon(isPrivate ? "lock" : "globe")} ${isPrivate ? "Password protected" : "Public"}</span>
    </div>
    <div class="sharetop">
      <div id="qr" class="qr"></div>
      <p class="note">${isPrivate
        ? "Visitors need the username and password. The private link opens the site without them."
        : "Anyone with the address can open it."}
        Scan to open it on your phone.</p>
    </div>
    ${line("Address", s.url)}
    ${isPrivate ? `
      ${line("Username", s.username)}
      ${line("Private link", s.privateLink)}` : ""}
    <div class="row" style="gap:6px;margin-top:12px">
      <button class="btn" id="change">${icon(isPrivate ? "globe" : "lock")} ${isPrivate ? "Change access" : "Add a password"}</button>
      ${isPrivate ? `<button class="btn ghost" id="reset" title="Make a new private link; the old one stops working">${icon("restart")} New link</button>` : ""}
    </div>
    <div id="form"></div>`;

  el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  el.querySelector("#change").onclick = () => accessForm(el.querySelector("#form"), base, s, () => shareCard(el, base));
  el.querySelector("#reset")?.addEventListener("click", async () => {
    if (!(await ask({ title: "Make a new private link?", text: "Anyone using the old one will need the password.", ok: "Make new link" }))) return;
    await api(`${base}/share/reset-link`, { method: "POST" });
    toast("New link created"); shareCard(el, base);
  });

  drawQr(el.querySelector("#qr"), s.privateLink ?? s.url);
}

// Public or password protected, with the username and password.
function accessForm(box, base, s, done) {
  const isPrivate = s.mode === "password";
  box.innerHTML = `
    <form class="shareform">
      <div class="choices" style="grid-template-columns:1fr 1fr">
        <label class="choice ${isPrivate ? "" : "on"}"><input type="radio" name="mode" value="public" ${isPrivate ? "" : "checked"} hidden>
          ${icon("globe")}<b>Public</b></label>
        <label class="choice ${isPrivate ? "on" : ""}"><input type="radio" name="mode" value="password" ${isPrivate ? "checked" : ""} hidden>
          ${icon("lock")}<b>Password</b></label>
      </div>
      <div id="creds" class="shareform" ${isPrivate ? "" : "hidden"}>
        <label>Username<input name="username" value="${esc(s.username)}" autocomplete="off"></label>
        <label>Password<input name="password" type="password" placeholder="${s.hasPassword ? "unchanged" : "choose a password"}" autocomplete="new-password"></label>
        <p class="note">The password isn't stored, so it can't be shown later. Forgot it? Choose a new one here.</p>
      </div>
      <p class="note">Files at files.… stay public either way.</p>
      <div class="row" style="gap:6px"><button class="btn primary">Save</button><button type="button" class="btn" data-x>Cancel</button></div>
    </form>`;
  const form = box.querySelector("form"), creds = box.querySelector("#creds");
  form.querySelectorAll("input[name=mode]").forEach((r) => (r.onchange = () => {
    form.querySelectorAll(".choice").forEach((c) => c.classList.toggle("on", c.contains(form.querySelector("input[name=mode]:checked"))));
    creds.hidden = form.mode.value !== "password";
  }));
  box.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`${base}/share`, { method: "PUT", body: { mode: form.mode.value, username: form.username.value, password: form.password.value } });
      toast(form.mode.value === "password" ? "Now password protected" : "Now public");
      done();
    } catch (err) { toast(err.message, "error"); }
  };
}

// A label, a value and a copy button.
const line = (label, value) => `
  <div class="shareline"><span class="note">${label}</span>
    <div class="row" style="gap:6px;flex-wrap:nowrap">
      <code class="grow">${esc(value)}</code>
      <button class="btn ghost" data-copy="${esc(value)}" title="Copy">${icon("copy")}</button>
    </div></div>`;

// QR code from a small library, loaded the first time it's needed.
let qrLib;
async function drawQr(el, text) {
  qrLib ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
    s.onload = ok; s.onerror = fail; document.head.append(s);
  });
  try {
    await qrLib;
    const qr = window.qrcode(0, "M");
    qr.addData(text); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { el.hidden = true; }
}
