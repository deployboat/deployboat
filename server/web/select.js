// Our own look for <select> boxes (the browser's differ on every system and don't match).
//
// Screens keep writing a plain <select>. This puts a button in our style next to it and
// hides the real one, which stays in the form: its value, the "change" and "input" events
// and form submits all work as before. Long lists (like time zones) get a search box.
//
// app.js calls watchSelects() once; from then on every new <select> is styled by itself.
// To keep a native one, add data-native to it.
import { icon, esc } from "./app.js";
import { openMenu } from "./menu.js";

const labelOf = (select) => select.selectedOptions[0]?.textContent ?? "";

function enhance(select) {
  if (select.dataset.native !== undefined || select.dataset.styled) return;
  select.dataset.styled = "1";
  select.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cselect";
  for (const c of select.classList) button.classList.add(c); // keep any width/size classes
  if (select.style.cssText) button.style.cssText = select.style.cssText;
  button.title = select.title;
  const draw = () => (button.innerHTML = `<span class="grow">${esc(labelOf(select))}</span>${icon("down")}`);
  draw();
  select.after(button);
  select.addEventListener("change", draw); // when the code changes it too
  button.disabled = select.disabled;

  button.onclick = () => openMenu(button, (menu, close) => {
    const options = [...select.options];
    const search = options.length > 12;
    menu.classList.add("cselect-menu");
    menu.style.minWidth = `${button.offsetWidth}px`;
    menu.innerHTML = `
      ${search ? `<input class="cselect-search" placeholder="Search" autocomplete="off">` : ""}
      <div class="cselect-list">${options.map((o, i) => `
        <button type="button" data-i="${i}" class="${o.selected ? "on" : ""}" ${o.disabled ? "disabled" : ""}>
          <span class="grow">${esc(o.textContent)}</span><span class="dd-check">${o.selected ? "✓" : ""}</span></button>`).join("")}</div>`;
    const list = menu.querySelector(".cselect-list");
    list.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => {
      close();
      if (select.selectedIndex === Number(b.dataset.i)) return;
      select.selectedIndex = Number(b.dataset.i);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      button.focus();
    }));
    const input = menu.querySelector(".cselect-search");
    if (input) {
      input.focus();
      input.oninput = () => {
        const q = input.value.toLowerCase();
        list.querySelectorAll("[data-i]").forEach((b) => (b.hidden = !b.textContent.toLowerCase().includes(q)));
      };
      input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); list.querySelector("[data-i]:not([hidden])")?.click(); } };
    }
    list.querySelector(".on")?.scrollIntoView({ block: "center" });
  });
}

// Style every <select> now, and any that screens add later.
export function watchSelects(root = document.body) {
  root.querySelectorAll("select").forEach(enhance);
  new MutationObserver((changes) => {
    for (const ch of changes) for (const n of ch.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === "SELECT") enhance(n);
      else n.querySelectorAll?.("select").forEach(enhance);
    }
  }).observe(root, { childList: true, subtree: true });
}
