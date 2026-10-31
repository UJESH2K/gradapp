import { h, clear, button, copy, fmtAgo } from "../ui.js";
import { store, subscribe } from "../store.js";

const EVENT_TEXT = {
  "node.joined": (d) => `${d.name || d.node_id} joined`,
  "node.left": (d) => `${d.name || d.node_id} left`,
  "node.evicted": (d) => `${d.name || d.node_id} was dropped: ${d.reason || "no heartbeat"}`,
  "run.created": (d) => `Run ${d.name || d.id} created`,
  "run.completed": (d) => `Run ${d.summary?.name || d.run_id || ""} completed`,
  "run.failed": (d) => `Run ${d.name || d.id} failed${d.error ? `: ${d.error}` : ""}`,
  "run.stopped": (d) => `Run ${d.name || d.id} stopped`,
  "node.offline": (d) => `${d.name || d.node_id} went offline`,
  "round.completed": (d) => `Round ${d.round ?? ""} finished${d.workers ? ` on ${d.workers} machine${d.workers === 1 ? "" : "s"}` : ""}${d.speedup ? `, ${Number(d.speedup).toFixed(2)}× faster than one` : ""}`,
  "dataset.added": (d) => `Dataset ${d.name || ""} added`,
  "mesh.token_rotated": () => "Mesh token rotated",
  "coordinator.ready": () => "Coordinator started",
};

function describe(event) {
  const fn = EVENT_TEXT[event.kind];
  if (fn) return fn(event.data || {});
  return event.kind.replace(/[._]/g, " ");
}

export function renderActivity(root) {
  let tab = "mesh";
  let filter = "";
  const body = h("div", { class: "activity-body" });
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const search = h("input", { class: "input input-sm", placeholder: "Filter", oninput: (e) => ((filter = e.target.value.toLowerCase()), draw()) });

  clear(
    root,
    h("header", { class: "page-head" }, h("h1", {}, "Activity")),
    h("div", { class: "toolbar" }, tabs, search, button("Open log folder", { kind: "ghost", small: true, iconName: "folder", onClick: () => window.gradapp.openLogs() })),
    body
  );

  function drawTabs() {
    clear(
      tabs,
      [
        ["mesh", "Mesh events"],
        ["log", "App and engine log"],
      ].map(([id, label]) =>
        h("button", { class: `tab${tab === id ? " is-active" : ""}`, role: "tab", "aria-selected": String(tab === id), onclick: () => ((tab = id), drawTabs(), draw()) }, label)
      )
    );
  }

  function draw() {
    if (tab === "mesh") {
      const events = store.events.filter((event) => !filter || describe(event).toLowerCase().includes(filter));
      clear(
        body,
        events.length
          ? h("ul", { class: "events" }, events.map((event) => h("li", {}, h("span", { class: "event-text" }, describe(event)), h("time", { class: "dim" }, fmtAgo(event.at)))))
          : h("p", { class: "dim" }, store.app?.target ? "Nothing yet. Joins, rounds and runs show up here as they happen." : "Connect to a mesh to see its events.")
      );
    } else {
      const lines = store.logs.filter((entry) => !filter || entry.line.toLowerCase().includes(filter) || entry.source.includes(filter)).slice(-500);
      const pre = h(
        "pre",
        { class: "log-full", tabindex: "0" },
        lines.map((entry) => h("span", { class: `log-line is-${entry.level}` }, h("span", { class: "log-src" }, entry.source.padEnd(12).slice(0, 12)), entry.line + "\n"))
      );
      clear(
        body,
        h("div", { class: "row" }, button("Copy", { kind: "ghost", small: true, iconName: "copy", onClick: () => copy(lines.map((l) => `[${l.source}] ${l.line}`).join("\n"), "Log copied") })),
        pre
      );
      pre.scrollTop = pre.scrollHeight;
    }
  }

  drawTabs();
  draw();
  let throttle = 0;
  return subscribe((reason) => {
    if ((reason === "event" && tab === "mesh") || (reason === "log" && tab === "log" && Date.now() - throttle > 400)) {
      throttle = Date.now();
      draw();
    }
  });
}
