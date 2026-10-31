import { h, clear, icon, toast, button } from "./ui.js";
import { store, emit, subscribe, startPolling, setView, pushLog, pushEvent, refreshMesh } from "./store.js";
import { onNavigate, go } from "./router.js";
import { openPalette } from "./palette.js";
import { renderHome } from "./views/home.js";
import { renderContribute } from "./views/contribute.js";
import { renderMesh } from "./views/mesh.js";
import { renderRuns } from "./views/runs.js";
import { renderDatasets } from "./views/datasets.js";
import { renderInvite } from "./views/invite.js";
import { renderActivity } from "./views/activity.js";
import { renderSettings } from "./views/settings.js";

export const VIEWS = [
  { id: "home", label: "Home", icon: "home", render: renderHome, key: "1" },
  { id: "contribute", label: "Contribute", icon: "contribute", render: renderContribute, key: "2" },
  { id: "mesh", label: "Mesh", icon: "mesh", render: renderMesh, key: "3" },
  { id: "runs", label: "Runs", icon: "runs", render: renderRuns, key: "4" },
  { id: "datasets", label: "Datasets", icon: "datasets", render: renderDatasets, key: "5" },
  { id: "invite", label: "Invite", icon: "invite", render: renderInvite, key: "6" },
  { id: "activity", label: "Activity", icon: "activity", render: renderActivity, key: "7" },
  { id: "settings", label: "Settings", icon: "settings", render: renderSettings, key: "," },
];

const isMac = window.gradapp.platform === "darwin";
const mod = isMac ? "⌘" : "Ctrl";

const app = document.getElementById("app");
const content = h("main", { class: "content", id: "content", tabindex: "-1" });
const nav = h("nav", { class: "nav", "aria-label": "Sections" });
const statusChip = h("button", { class: "status-chip", onclick: () => go(store.app?.host?.state === "live" ? "mesh" : "contribute") });
const updateBanner = h("div", { class: "update-banner", hidden: true });
let cleanup = null;

function navButton(view) {
  return h(
    "button",
    {
      class: "nav-item",
      "data-view": view.id,
      title: `${view.label} (${mod}+${view.key})`,
      onclick: () => go(view.id),
    },
    icon(view.icon, 18),
    h("span", { class: "nav-label" }, view.label),
    view.id === "contribute" || view.id === "mesh" ? h("span", { class: "nav-dot", "data-dot": view.id }) : null
  );
}

function shell() {
  const main = VIEWS.filter((v) => v.id !== "settings" && v.id !== "activity");
  const foot = VIEWS.filter((v) => v.id === "activity" || v.id === "settings");
  clear(nav, h("div", { class: "nav-group" }, main.map(navButton)), h("div", { class: "nav-group nav-foot" }, foot.map(navButton)));

  clear(
    app,
    h(
      "aside",
      { class: "sidebar" },
      h("div", { class: "brand" }, h("img", { src: "./logo.svg", alt: "", width: 22, height: 22 }), h("span", { class: "brand-name" }, "GradApp")),
      nav
    ),
    h(
      "div",
      { class: "main" },
      h(
        "header",
        { class: "titlebar" },
        h("button", { class: "search-pill", onclick: () => openPalette(VIEWS) }, icon("search", 15), h("span", {}, "Search or jump to…"), h("kbd", {}, `${mod} K`)),
        statusChip
      ),
      updateBanner,
      content
    )
  );
}

function renderStatus() {
  const a = store.app?.agent;
  const hst = store.app?.host;
  if (!a || !hst) return;
  let label = "Idle";
  let tone = "idle";
  if (a.state === "training") [label, tone] = ["Training", "busy"];
  else if (a.state === "online") [label, tone] = ["Contributing", "live"];
  else if (a.state === "starting") [label, tone] = ["Joining", "info"];
  else if (a.state === "reconnecting") [label, tone] = ["Reconnecting", "warn"];
  else if (a.state === "error") [label, tone] = ["Needs attention", "danger"];
  if (hst.state === "live") label = tone === "idle" ? `Hosting ${hst.meshName || ""}`.trim() : `Hosting · ${label}`;
  if (hst.state === "live" && tone === "idle") tone = "live";
  if (hst.state === "starting") [label, tone] = ["Starting mesh", "info"];
  if (hst.state === "error" && tone === "idle") [label, tone] = ["Host stopped", "danger"];
  statusChip.dataset.tone = tone;
  clear(statusChip, h("span", { class: "status-dot" }), h("span", {}, label));

  nav.querySelector('[data-dot="contribute"]')?.setAttribute("data-tone", ["online", "training"].includes(a.state) ? "live" : a.state === "error" ? "danger" : "");
  nav.querySelector('[data-dot="mesh"]')?.setAttribute("data-tone", hst.state === "live" ? "live" : "");
}

function show(viewId) {
  const view = VIEWS.find((v) => v.id === viewId) || VIEWS[0];
  cleanup?.();
  cleanup = null;
  setView(view.id);
  for (const item of nav.querySelectorAll(".nav-item")) {
    const active = item.dataset.view === view.id;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  content.replaceChildren();
  content.scrollTop = 0;
  const result = view.render(content);
  cleanup = typeof result === "function" ? result : null;
  try {
    localStorage.setItem("gradapp:view", view.id);
  } catch {
    // storage is a convenience only
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "system");
}

function keyboard() {
  window.addEventListener("keydown", (event) => {
    const meta = isMac ? event.metaKey : event.ctrlKey;
    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette(VIEWS);
      return;
    }
    if (meta && !event.shiftKey && !event.altKey) {
      const view = VIEWS.find((v) => v.key === event.key);
      if (view) {
        event.preventDefault();
        go(view.id);
      }
    }
    if (event.key === "Escape" && document.activeElement === document.body && store.app?.settings?.closeToTray) {
      // Esc on an idle window tucks it into the tray: the discreet exit.
      window.gradapp.hide();
    }
  });
}

async function boot() {
  document.documentElement.classList.add(isMac ? "is-mac" : `is-${window.gradapp.platform}`);
  shell();
  keyboard();
  onNavigate((view) => show(view));

  store.app = await window.gradapp.state();
  applyTheme(store.app.settings.theme);
  for (const entry of await window.gradapp.logs()) store.logs.push(entry);
  renderStatus();

  window.gradapp.on("state", (state) => {
    const hadTarget = Boolean(store.app?.target);
    store.app = state;
    renderStatus();
    emit("state");
    if (Boolean(state.target) !== hadTarget) refreshMesh();
  });
  window.gradapp.on("log", pushLog);
  window.gradapp.on("mesh:event", pushEvent);
  window.gradapp.on("navigate", (view) => go(view));
  window.gradapp.on("invite", () => {
    // Re-render Contribute so it takes the invite, even if already open.
    show("contribute");
  });
  window.gradapp.on("update", (update) => {
    clear(
      updateBanner,
      h("span", {}, `GradApp ${update.latest} is available.`),
      button("Download", { kind: "ghost", small: true, onClick: () => window.gradapp.openExternal(update.url) }),
      h("button", { class: "icon-btn", "aria-label": "Dismiss", onclick: () => (updateBanner.hidden = true) }, icon("x", 14))
    );
    updateBanner.hidden = false;
  });

  let initial = "home";
  try {
    initial = localStorage.getItem("gradapp:view") || "home";
  } catch {
    // ignore
  }
  const invite = await window.gradapp.takeInvite();
  if (invite) {
    // Held for the Contribute screen to pick up.
    store.pendingInvite = invite;
  }
  show(invite ? "contribute" : initial);
  startPolling();

  window.gradapp.hardware().then((hw) => {
    store.hardware = hw;
    emit("hardware");
  });

  app.dataset.ready = "yes";
}

boot().catch((error) => {
  console.error(error);
  app.textContent = `GradApp could not start its window: ${error.message}`;
});

export { subscribe };
