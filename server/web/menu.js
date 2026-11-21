// A floating menu that opens next to a button (for dropdowns and "⋯" menus).
//
//   openMenu(button, (menu, close) => { menu.innerHTML = "…"; …wire up clicks, call close() when done… })
//
// It floats above the page (nothing below it moves), stays inside the window,
// and closes on a click outside, the Escape key, or scrolling the page.
// Only one menu is open at a time.

let current = null; // { el, close }

export const isMenuOpen = () => !!current;

export function openMenu(anchor, fill, { align = "left" } = {}) {
  current?.close();

  const el = document.createElement("div");
  el.className = "dropdown";
  document.body.append(el);

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const onOutside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  // Scrolling closes it, but only when it moves the button the menu hangs from (the page,
  // or a box around the button). Not when scrolling inside the menu, while typing in it (on
  // phones the keyboard opening scrolls the page), or when something else scrolls by itself
  // (like a live log adding lines).
  const onScroll = (e) => {
    if (el.contains(e.target) || el.contains(document.activeElement)) return;
    if (e.target === document || e.target.contains?.(anchor)) close();
  };
  function close() {
    el.remove();
    anchor.classList.remove("open");
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
    removeEventListener("scroll", onScroll, true);
    if (current?.el === el) current = null;
  }

  fill(el, close);
  anchor.classList.add("open");

  // Place it under the button; flip above it if there's no room below.
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = align === "right" ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  document.addEventListener("mousedown", onOutside);
  document.addEventListener("keydown", onKey);
  addEventListener("scroll", onScroll, true);
  current = { el, close };
  return close;
}

// A dropdown that picks one option, like a <select>.
//   pickOne(button, [["newest", "Newest first"], …], "newest", (value) => …)
export function pickOne(anchor, options, selected, onPick, { title } = {}) {
  openMenu(anchor, (menu, close) => {
    menu.innerHTML = `${title ? `<div class="dd-title">${title}</div>` : ""}` + options.map(([value, label]) => `
      <button data-v="${value}" class="${value === selected ? "on" : ""}">
        <span class="grow">${label}</span><span class="dd-check">${value === selected ? "✓" : ""}</span>
      </button>`).join("");
    menu.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { close(); onPick(b.dataset.v); }));
  });
}
