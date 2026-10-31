// Small DOM toolkit. No framework: the app is a handful of screens and a
// framework would cost more startup time than it saves.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "html") el.innerHTML = value; // only ever used with our own icon markup
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  contribute: '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/>',
  mesh: '<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="6" r="1.8"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="18" r="1.8"/><path d="M6.4 7.2 10.3 10.6M17.6 7.2l-3.9 3.4M6.4 16.8l3.9-3.4M17.6 16.8l-3.9-3.4"/>',
  runs: '<path d="M4 19h16"/><path d="M6 15l4-5 3 3 5-7"/>',
  datasets: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6"/><path d="M5 11.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6"/>',
  invite: '<path d="M15 19v-1.5A3.5 3.5 0 0 0 11.5 14h-5A3.5 3.5 0 0 0 3 17.5V19"/><circle cx="9" cy="7.5" r="3.5"/><path d="M19 8v6M22 11h-6"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement("span");
  span.className = "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ""}</svg>`;
  return span;
}

export function button(label, { kind = "secondary", iconName, onClick, disabled, title, type = "button", small } = {}) {
  return h(
    "button",
    { class: `btn btn-${kind}${small ? " btn-sm" : ""}`, type, onclick: onClick, disabled, title },
    iconName ? icon(iconName, small ? 15 : 17) : null,
    label ? h("span", {}, label) : null
  );
}

/** Run an async action with the button showing it is busy, and surface errors as a toast. */
export async function busy(btn, action) {
  const before = btn.disabled;
  btn.disabled = true;
  btn.classList.add("is-busy");
  try {
    const result = await action();
    if (result && result.ok === false && !result.canceled) toast(result.error || "That did not work.", "error");
    return result;
  } catch (error) {
    toast(error?.message || String(error), "error");
    return null;
  } finally {
    btn.disabled = before;
    btn.classList.remove("is-busy");
  }
}

let toastHost = null;
export function toast(message, kind = "info", ms = 4200) {
  if (!toastHost) {
    toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const el = h("div", { class: `toast toast-${kind}` }, icon(kind === "error" ? "x" : "check", 15), h("span", {}, message));
  toastHost.append(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  }, ms);
}

export async function copy(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Could not reach the clipboard.", "error");
  }
}

export function copyField(value, { secret = false, label } = {}) {
  let shown = !secret;
  const text = h("code", { class: "copy-value" });
  const render = () => (text.textContent = shown ? value : "•".repeat(Math.min(28, value.length)));
  render();
  const eye = secret
    ? h("button", {
        class: "icon-btn",
        title: "Show or hide",
        "aria-label": "Show or hide",
        onclick: () => {
          shown = !shown;
          clear(eye, icon(shown ? "eyeOff" : "eye", 16));
          render();
        },
      }, icon("eye", 16))
    : null;
  return h(
    "div",
    { class: "copy-field" },
    text,
    eye,
    h("button", { class: "icon-btn", title: "Copy", "aria-label": `Copy ${label || ""}`, onclick: () => copy(value, `${label || "Value"} copied`) }, icon("copy", 16))
  );
}

export function field(label, control, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
}

export function toggle(checked, onChange, labelText) {
  const input = h("input", { type: "checkbox", role: "switch", checked: Boolean(checked), onchange: (e) => onChange(e.target.checked) });
  return h("label", { class: "switch" }, input, h("span", { class: "switch-track" }, h("span", { class: "switch-thumb" })), labelText ? h("span", { class: "switch-label" }, labelText) : null);
}

export function select(options, value, onChange) {
  const el = h("select", { class: "input", onchange: (e) => onChange?.(e.target.value) });
  for (const option of options) {
    const [v, label] = Array.isArray(option) ? option : [option, option];
    el.append(h("option", { value: v, selected: String(v) === String(value) }, label));
  }
  return el;
}

export function emptyState(title, body, action) {
  return h("div", { class: "empty" }, h("p", { class: "empty-title" }, title), body ? h("p", { class: "empty-body" }, body) : null, action || null);
}

export function pill(text, tone = "neutral") {
  return h("span", { class: `pill pill-${tone}` }, text);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtBytes(mb) {
  if (!mb && mb !== 0) return "–";
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${Math.round(mb)} MB`;
}

export function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtAgo(at) {
  if (!at) return "–";
  const ms = typeof at === "number" && at < 1e12 ? at * 1000 : at;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export const VENDOR = {
  cuda: { label: "NVIDIA", tone: "nvidia" },
  xpu: { label: "Intel", tone: "intel" },
  mps: { label: "Apple", tone: "apple" },
  cpu: { label: "CPU", tone: "neutral" },
};

export function vendorBadge(backend, { compact = false } = {}) {
  const vendor = VENDOR[backend] || VENDOR.cpu;
  return h("span", { class: `vendor vendor-${vendor.tone}${compact ? " is-compact" : ""}`, title: vendor.label }, vendor.label);
}
