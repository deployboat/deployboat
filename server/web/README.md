# web

The dashboard. Plain HTML/CSS/JS, no build step.

- `app.js` — router + helpers
- `screens/` — one file per screen
- `style.css` — all styles
- `editor.js` — the code editor (CodeMirror), loaded only when needed
- `vendor/` — third-party files, served as-is (see its README)
- `menu.js` — floating menus and dropdowns
- `select.js` — styles every `<select>` like the rest of the dashboard (add `data-native` to skip one)
- `dialog.js` — our confirm and prompt dialogs: `ask`, `askText`, `askTyped` (use these, not `confirm()`/`prompt()`)
