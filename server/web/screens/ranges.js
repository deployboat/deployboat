// The 1h / 24h / 7d / 30d switch above history charts.
export function rangePicker(el, current, onPick) {
  el.innerHTML = `<span class="ranges">${["1h", "24h", "7d", "30d"].map((r) =>
    `<button class="${r === current ? "on" : ""}" data-r="${r}">${r}</button>`).join("")}</span>`;
  el.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => onPick(b.dataset.r)));
}
