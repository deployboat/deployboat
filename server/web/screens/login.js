// Login: paste the token once. The server keeps you logged in with a cookie.
import { api } from "../app.js";

export function loginScreen(view, onDone) {
  view.innerHTML = `
    <div class="login">
      <svg viewBox="0 0 32 32"><path d="M16 4v18" stroke="currentColor" stroke-width="2"/><path d="M17 5l9 14h-9z" fill="var(--accent)"/><path d="M5 23h22l-4 5H9z" fill="currentColor"/></svg>
      <h1>Welcome aboard</h1>
      <p class="muted">Log in with your server token.</p>
      <form>
        <input name="token" placeholder="dbt_…" autocomplete="off" autofocus required>
        <div class="error"></div>
        <button class="btn primary" style="justify-content:center">Log in</button>
        <small>Find it on your server: <code>sudo cat /var/lib/deployboat/token</code></small>
      </form>
    </div>`;

  const form = view.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/auth/login", { method: "POST", body: { token: form.token.value } });
      onDone();
    } catch (err) {
      view.querySelector(".error").textContent = err.message;
    }
  };
}
