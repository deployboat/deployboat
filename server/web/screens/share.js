// Share page: public or password protected, and a share box (link, QR, private link).
import { api, esc, icon, toast, copy } from "../app.js";

export async function share(box, base) {
  const s = await api(`${base}/share`);
  const isPrivate = s.mode === "password";
  box.innerHTML = `
    <form class="card pad" id="who">
      <b>Who can see this app?</b>
      <div class="choices" style="grid-template-columns:1fr 1fr;margin-top:12px">
        <label class="choice ${isPrivate ? "" : "on"}"><input type="radio" name="mode" value="public" ${isPrivate ? "" : "checked"} hidden>
          ${icon("globe")}<b>Public</b><span>Anyone with the address</span></label>
        <label class="choice ${isPrivate ? "on" : ""}"><input type="radio" name="mode" value="password" ${isPrivate ? "checked" : ""} hidden>
          ${icon("lock")}<b>Password protected</b><span>Visitors enter a username and password</span></label>
      </div>
      <div id="creds" class="row" style="margin-top:14px;align-items:flex-end" ${isPrivate ? "" : "hidden"}>
        <label class="form" style="flex:1;min-width:140px;gap:4px">Username<input name="username" value="${esc(s.username)}" autocomplete="off"></label>
        <label class="form" style="flex:1;min-width:160px;gap:4px">Password
          <input name="password" type="password" placeholder="${s.hasPassword ? "unchanged" : "choose a password"}" autocomplete="new-password"></label>
      </div>
      <div class="row spread" style="margin-top:14px">
        <span class="note">Files at files.… stay public either way.</span>
        <button class="btn primary">Save</button>
      </div>
    </form>

    <div class="card pad" style="margin-top:14px">
      <b>Share</b>
      <div class="sharebox">
        <div id="qr" class="qr"></div>
        <div style="display:grid;gap:12px;min-width:0">
          <div><span class="note">Address</span>${line(s.url)}</div>
          ${isPrivate ? `
            <div><span class="note">Username (the password isn't stored, so it can't be shown. Forgot it? Choose a new one above.)</span>${line(s.username)}</div>
            <div><span class="note">Private link: opens the site without the password prompt</span>${line(s.privateLink)}
              <button class="btn" id="reset" style="margin-top:8px">${icon("restart")} Reset link</button>
              <span class="note">Old private links stop working.</span></div>` : ""}
        </div>
      </div>
    </div>`;

  // Copy buttons.
  box.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));

  const form = box.querySelector("#who"), creds = box.querySelector("#creds");
  form.querySelectorAll("input[name=mode]").forEach((r) => (r.onchange = () => {
    form.querySelectorAll(".choice").forEach((c) => c.classList.toggle("on", c.contains(r) ? r.checked : !r.checked));
    creds.hidden = r.value !== "password" || !r.checked;
  }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`${base}/share`, { method: "PUT", body: { mode: form.mode.value, username: form.username.value, password: form.password.value } });
      toast(form.mode.value === "password" ? "Now password protected" : "Now public");
      share(box, base);
    } catch (err) { toast(err.message); }
  };
  box.querySelector("#reset")?.addEventListener("click", async () => {
    if (!confirm("Make a new private link? Anyone using the old one will need the password.")) return;
    await api(`${base}/share/reset-link`, { method: "POST" });
    toast("New link created"); share(box, base);
  });

  drawQr(box.querySelector("#qr"), s.privateLink ?? s.url);
}

const line = (text, copyValue = text) => `
  <div class="row" style="gap:8px;flex-wrap:nowrap;margin-top:4px">
    <code class="grow" style="background:var(--bg);padding:7px 10px;border-radius:7px;border:1px solid var(--line)">${esc(text)}</code>
    <button class="btn" data-copy="${esc(copyValue)}">${icon("copy")}</button>
  </div>`;

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
