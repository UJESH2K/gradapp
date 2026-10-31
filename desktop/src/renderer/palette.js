// Ctrl/Cmd+K: every screen and every action by typing a few letters.

import { h, clear, icon, toast, copy } from "./ui.js";
import { store } from "./store.js";
import { go } from "./router.js";

function actions() {
  const app = store.app || {};
  const contributing = app.agent && !["idle", "error"].includes(app.agent.state);
  const hosting = app.host?.state === "live";
  const list = [];
  if (contributing) list.push({ label: "Stop contributing", icon: "stop", run: () => window.gradapp.leave() });
  else list.push({ label: "Contribute this GPU", icon: "contribute", run: () => go("contribute") });
  if (!contributing && app.settings?.lastMesh) {
    list.push({ label: `Rejoin ${app.settings.lastMesh.meshName || app.settings.lastMesh.hostname || "last mesh"}`, icon: "refresh", run: () => window.gradapp.join(app.settings.lastMesh) });
  }
  if (hosting) {
    list.push({ label: "Stop hosting", icon: "power", run: () => window.gradapp.stopHost() });
    list.push({
      label: "Copy invite link",
      icon: "link",
      run: async () => {
        const info = await window.gradapp.invite();
        if (info?.invite) copy(info.invite, "Invite link copied");
      },
    });
    if (!contributing) list.push({ label: "Use this computer's GPU too", icon: "plus", run: () => window.gradapp.contributeLocal() });
  } else if (app.host?.state !== "starting") {
    list.push({ label: "Host a mesh", icon: "mesh", run: () => window.gradapp.host() });
  }
  list.push({ label: "Upload a dataset", icon: "upload", run: () => (go("datasets"), window.gradapp.uploadDataset(false)) });
  list.push({
    label: "Toggle dark and light",
    icon: "eye",
    run: async () => {
      const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      await window.gradapp.setSettings({ theme: next });
    },
  });
  list.push({ label: "Hide to tray", icon: "x", run: () => window.gradapp.hide() });
  list.push({ label: "Quit GradApp", icon: "power", run: () => window.gradapp.quit() });
  return list;
}

let openEl = null;

export function openPalette(views) {
  if (openEl) return;
  const previous = document.activeElement;
  const input = h("input", { class: "palette-input", placeholder: "Type a screen or an action", "aria-label": "Search", autocomplete: "off", spellcheck: false });
  const list = h("ul", { class: "palette-list", role: "listbox" });
  let items = [];
  let index = 0;

  const all = () => [
    ...views.map((view) => ({ label: view.label, hint: "Go to", icon: view.icon, run: () => go(view.id) })),
    ...actions().map((action) => ({ ...action, hint: "Action" })),
  ];

  const score = (label, query) => {
    const text = label.toLowerCase();
    if (!query) return 1;
    if (text.startsWith(query)) return 3;
    if (text.split(/\s+/).some((word) => word.startsWith(query))) return 2;
    let at = 0;
    for (const ch of query) {
      at = text.indexOf(ch, at);
      if (at === -1) return 0;
      at += 1;
    }
    return 1;
  };

  const draw = () => {
    const query = input.value.trim().toLowerCase();
    items = all()
      .map((item) => ({ item, s: score(item.label, query) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((entry) => entry.item);
    index = Math.min(index, Math.max(items.length - 1, 0));
    clear(
      list,
      items.length
        ? items.map((item, i) =>
            h(
              "li",
              {
                class: `palette-item${i === index ? " is-active" : ""}`,
                role: "option",
                "aria-selected": String(i === index),
                onmousemove: () => {
                  if (index !== i) {
                    index = i;
                    draw();
                  }
                },
                onclick: () => choose(i),
              },
              icon(item.icon, 16),
              h("span", { class: "palette-label" }, item.label),
              h("span", { class: "palette-hint" }, item.hint)
            )
          )
        : h("li", { class: "palette-empty" }, "Nothing matches.")
    );
  };

  const close = () => {
    openEl?.remove();
    openEl = null;
    previous?.focus?.();
  };

  const choose = async (i) => {
    const item = items[i];
    close();
    if (!item) return;
    try {
      const result = await item.run();
      if (result && result.ok === false && !result.canceled) toast(result.error, "error");
    } catch (error) {
      toast(error.message, "error");
    }
  };

  input.addEventListener("input", () => {
    index = 0;
    draw();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index = (index + 1) % Math.max(items.length, 1);
      draw();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = (index - 1 + items.length) % Math.max(items.length, 1);
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  openEl = h(
    "div",
    { class: "palette-backdrop", onmousedown: (e) => e.target === openEl && close() },
    h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" }, h("div", { class: "palette-search" }, icon("search", 16), input), list)
  );
  document.body.append(openEl);
  draw();
  input.focus();
}
