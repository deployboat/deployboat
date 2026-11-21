// The code editor on the Files page: CodeMirror 5, from web/vendor/codemirror.
// It's only loaded the first time a file is opened, so other pages stay light.
//
//   const cm = await codeEditor(element, text, "server.js");
//   cm.getValue(); cm.on("change", …);

let loading = null;

// Add a <script> or <link> and wait for it to load.
const add = (tag, attrs) => new Promise((ok, fail) => {
  const el = Object.assign(document.createElement(tag), attrs, { onload: ok, onerror: fail });
  document.head.append(el);
});

// CodeMirror first, then its add-ons and languages (they need it).
function load() {
  const base = "/vendor/codemirror";
  loading ??= (async () => {
    await add("link", { rel: "stylesheet", href: `${base}/codemirror.css` });
    await add("script", { src: `${base}/codemirror.js` });
    await add("script", { src: `${base}/addon/simple.js` });
    // xml and clike before the languages built on them (htmlmixed, php, go).
    for (const m of ["xml", "javascript", "css", "clike", "htmlmixed", "python", "yaml", "markdown", "shell",
      "sql", "toml", "properties", "dockerfile", "go", "ruby", "php", "nginx"]) {
      await add("script", { src: `${base}/mode/${m}.js` });
    }
  })();
  return loading;
}

// File name → CodeMirror language. Anything not listed is plain text.
const MODES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "text/typescript", tsx: "text/typescript", json: "application/json",
  css: "css", scss: "text/x-scss", less: "text/x-less",
  html: "htmlmixed", htm: "htmlmixed", vue: "htmlmixed", svelte: "htmlmixed", xml: "xml", svg: "xml",
  py: "python", rb: "ruby", go: "go", php: "php", java: "text/x-java", c: "text/x-csrc", h: "text/x-csrc",
  cpp: "text/x-c++src", cs: "text/x-csharp", kt: "text/x-kotlin",
  yml: "yaml", yaml: "yaml", toml: "toml", ini: "properties", conf: "nginx", env: "properties",
  md: "markdown", sh: "shell", bash: "shell", sql: "sql",
};
export function modeFor(name) {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  if (lower.startsWith(".env")) return "properties";
  return MODES[lower.split(".").pop()] ?? "text/plain";
}

export async function codeEditor(el, text, name) {
  await load();
  return window.CodeMirror(el, {
    value: text,
    mode: modeFor(name),
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: false,
    extraKeys: { Tab: (cm) => cm.replaceSelection("  ") }, // spaces, not tab characters
  });
}
