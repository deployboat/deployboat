// Our own dialogs, instead of the browser's confirm() and prompt().
//
//   if (!(await ask({ title: "Delete this job?", text: "Its history goes too.", ok: "Delete", danger: true }))) return;
//   const name = await askText({ title: "New folder", label: "Folder name" });     // null if cancelled
//   if (!(await askTyped({ title: "Delete the database?", text: "…", word: app.name, ok: "Delete database" }))) return;
//
// Enter confirms, Escape or a click outside cancels. Only one dialog at a time.
import { esc, icon } from "./app.js";

// Show a dialog and wait for the answer. `body` is extra HTML (an input), `read` gives the result.
function open({ title, text = "", ok = "OK", cancel = "Cancel", danger = false, body = "", read = () => true, ready = () => true }) {
  document.querySelector(".dlg-back")?.remove(); // one at a time
  const back = document.createElement("div");
  back.className = "dlg-back";
  back.innerHTML = `
    <form class="dlg card" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <div class="dlg-main">
        ${danger ? `<span class="dlg-icon">${icon("alert")}</span>` : ""}
        <div class="grow">
          <h3 id="dlg-title">${esc(title)}</h3>
          ${text ? `<div class="dlg-text">${text.split("\n\n").map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>` : ""}
          ${body}
        </div>
      </div>
      <div class="dlg-foot">
        <button type="button" class="btn" data-cancel>${esc(cancel)}</button>
        <button class="btn ${danger ? "danger solid" : "primary"}" data-ok>${esc(ok)}</button>
      </div>
    </form>`;
  document.body.append(back);
  const form = back.querySelector("form"), okBtn = back.querySelector("[data-ok]");
  const before = document.activeElement;

  return new Promise((resolve) => {
    const done = (value) => {
      back.remove();
      removeEventListener("keydown", onKey, true);
      before?.focus?.();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } };
    addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", (e) => { if (e.target === back) done(null); });
    back.querySelector("[data-cancel]").onclick = () => done(null);
    // Some dialogs keep "OK" off until the input is right (like typing the app's name).
    const check = () => (okBtn.disabled = !ready(form));
    form.addEventListener("input", check); check();
    form.onsubmit = (e) => { e.preventDefault(); if (ready(form)) done(read(form)); };
    (form.querySelector("input") ?? (danger ? back.querySelector("[data-cancel]") : okBtn)).focus();
  });
}

// Yes or no. Resolves true or false.
export const ask = async (opts) => (await open(opts)) === true;

// Ask for a short text (a name). Resolves the text, or null if cancelled.
export const askText = ({ label = "", value = "", placeholder = "", ...opts }) => open({
  ok: "Save", ...opts,
  body: `<label class="dlg-field">${esc(label)}<input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"></label>`,
  ready: (f) => f.v.value.trim() !== "",
  read: (f) => f.v.value.trim(),
});

// For deleting things that can't come back: type `word` to unlock the button.
export const askTyped = async ({ word, ...opts }) => (await open({
  danger: true, ...opts,
  body: `<label class="dlg-field"><span>Type <b>${esc(word)}</b> to confirm</span><input name="v" autocomplete="off" spellcheck="false"></label>`,
  ready: (f) => f.v.value.trim() === word,
})) === true;
