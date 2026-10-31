import { h, clear, icon, button, busy, emptyState, pill, vendorBadge, fmtBytes, fmtNumber, fmtAgo, toast } from "../ui.js";
import { store, subscribe, refreshMesh } from "../store.js";
import { go } from "../router.js";

function nodeStatus(node) {
  if (!node.active || node.liveness === "offline") return ["Offline", "neutral"];
  if (node.liveness === "suspect") return ["Not answering", "warn"];
  if ((node.active_batches || 0) > 0) {
    const phase = node.phase && node.phase !== "training" ? node.phase : "training";
    const progress = node.progress?.batches ? ` ${Math.round((node.progress.batch / node.progress.batches) * 100)}%` : "";
    return [`${phase[0].toUpperCase()}${phase.slice(1)}${progress}`, "busy"];
  }
  if (node.tier === "rejected") return ["Not admitted", "danger"];
  if (node.tier === "probation") return ["Probation", "warn"];
  return ["Ready", "live"];
}

function metric(value, label) {
  return h("div", { class: "metric" }, h("span", { class: "metric-value" }, value), h("span", { class: "metric-label" }, label));
}

export function noMesh(root) {
  clear(
    root,
    h("header", { class: "page-head" }, h("h1", {}, "Mesh")),
    emptyState(
      "Not connected to a mesh",
      "Host one from this computer, or contribute to one on your network. Machines, runs and datasets appear here once you are connected.",
      h(
        "div",
        { class: "row" },
        button("Host a mesh", { kind: "primary", iconName: "mesh", onClick: (e) => busy(e.currentTarget, () => window.gradapp.host()) }),
        button("Find a mesh", { kind: "secondary", iconName: "wifi", onClick: () => go("contribute") })
      )
    )
  );
}

export function renderMesh(root) {
  const metrics = h("div", { class: "metrics" });
  const table = h("div", { class: "nodes" });
  const notice = h("div");
  const heading = h("h1", {}, "Mesh");
  const sub = h("p", { class: "lede" });

  const draw = () => {
    if (!store.app?.target) return noMesh(root);
    if (!root.contains(table)) {
      clear(root, h("header", { class: "page-head" }, heading, sub), notice, metrics, table);
    }
    const mesh = store.mesh;
    heading.textContent = mesh?.mesh_name || store.app.target.meshName || "Mesh";
    sub.textContent = mesh ? `GradMesh ${mesh.version} at ${store.app.target.coordinator}${mesh.torch_ready ? "" : " · host still installing PyTorch"}` : "Connecting…";
    if (store.meshError && !mesh) {
      clear(notice);
      clear(metrics);
      clear(
        table,
        emptyState(
          "This mesh is not answering",
          `${store.app.target.coordinator} did not respond. The host may be off, asleep, or on another network.`,
          h(
            "div",
            { class: "row" },
            button("Try again", { kind: "secondary", iconName: "refresh", onClick: (e) => busy(e.currentTarget, () => refreshMesh()) }),
            button("Find another mesh", { kind: "ghost", iconName: "wifi", onClick: () => go("contribute") })
          )
        )
      );
      return;
    }
    clear(notice, store.meshError ? h("p", { class: "callout callout-warn" }, `Lost contact a moment ago: ${store.meshError}`) : null);
    if (!mesh) return;

    const m = mesh.metrics || {};
    clear(
      metrics,
      metric(`${m.nodes_active ?? 0}`, `online of ${m.nodes_total ?? 0}`),
      metric(`${m.nodes_training ?? 0}`, "training now"),
      metric(m.total_gflops ? `${fmtNumber(m.total_gflops / 1000, 1)}` : "0", "TFLOPS pooled"),
      metric(fmtBytes(m.total_memory_mb || 0), "GPU memory"),
      metric(`${(mesh.active_runs || []).length}`, "active runs")
    );

    const nodes = [...(mesh.nodes || [])].sort((a, b) => Number(b.active) - Number(a.active) || (b.throughput_sps || 0) - (a.throughput_sps || 0));
    if (!nodes.length) {
      clear(
        table,
        emptyState(
          "No machines yet",
          store.app.host.state === "live" ? "Invite machines on this network, or use this computer's GPU too." : "Machines appear here as they join.",
          store.app.host.state === "live"
            ? h("div", { class: "row" }, button("Invite machines", { kind: "primary", iconName: "invite", onClick: () => go("invite") }), button("Use this computer", { kind: "secondary", onClick: (e) => busy(e.currentTarget, () => window.gradapp.contributeLocal()) }))
            : null
        )
      );
      return;
    }
    const mine = store.app.agent?.nodeId;
    const isOwner = store.app.host.state === "live";
    clear(
      table,
      h(
        "div",
        { class: "nodes-head", role: "row" },
        h("span", {}, "Machine"),
        h("span", {}, "GPU"),
        h("span", { class: "num" }, "Images/s"),
        h("span", { class: "num" }, "Rounds"),
        h("span", {}, "Status")
      ),
      nodes.map((node) => {
        const [label, tone] = nodeStatus(node);
        const warnings = node.warnings || [];
        return h(
          "details",
          { class: `node${node.active ? "" : " is-offline"}` },
          h(
            "summary",
            { class: "node-row", role: "row" },
            h("span", { class: "node-name" }, h("strong", {}, node.display_name || node.node_id), node.node_id === mine ? pill("this computer", "info") : null, node.owner ? h("span", { class: "dim" }, node.owner) : null),
            h("span", { class: "node-gpu" }, vendorBadge(node.backend, { compact: true }), h("span", {}, node.gpu || "–"), node.gpu_memory_mb ? h("span", { class: "dim" }, fmtBytes(node.gpu_memory_mb)) : null),
            h("span", { class: "num" }, fmtNumber(node.throughput_sps, 1)),
            h("span", { class: "num" }, fmtNumber(node.completed_rounds || 0)),
            h("span", {}, pill(label, tone), warnings.length ? h("span", { class: "warn-dot", title: warnings.join("\n") }, "!") : null)
          ),
          h(
            "div",
            { class: "node-detail" },
            h(
              "dl",
              {},
              h("dt", {}, "Software"),
              h("dd", {}, node.software ? `Python ${node.software.python}, torch ${node.software.torch} (${node.software.torch_build}), ${node.software.runtime}` : node.capability?.torch_version ? `torch ${node.capability.torch_version}` : "–"),
              h("dt", {}, "System"),
              h("dd", {}, node.software?.os || node.capability?.platform || "–"),
              h("dt", {}, "Admission"),
              h("dd", {}, node.admission_reason || node.tier || "–"),
              h("dt", {}, "Last seen"),
              h("dd", {}, fmtAgo(node.last_seen)),
              node.software?.drift?.length ? [h("dt", {}, "Differs from reference"), h("dd", {}, node.software.drift.join(", "))] : null,
              warnings.length ? [h("dt", {}, "Warnings"), h("dd", {}, warnings.join(" · "))] : null
            ),
            isOwner
              ? h(
                  "div",
                  { class: "row" },
                  button("Reset statistics", {
                    kind: "ghost",
                    small: true,
                    onClick: (e) =>
                      busy(e.currentTarget, async () => {
                        const result = await window.gradapp.api("POST", `/nodes/${node.node_id}/reset`);
                        if (result.ok) toast("Statistics reset");
                        refreshMesh();
                        return result;
                      }),
                  }),
                  button("Remove", {
                    kind: "ghost",
                    small: true,
                    iconName: "trash",
                    onClick: (e) =>
                      busy(e.currentTarget, async () => {
                        const result = await window.gradapp.api("DELETE", `/nodes/${node.node_id}`);
                        if (result.ok) toast(`${node.display_name || "Machine"} removed`);
                        refreshMesh();
                        return result;
                      }),
                  })
                )
              : null
          )
        );
      })
    );
  };

  // Keep open rows open across refreshes.
  const openRows = new Set();
  table.addEventListener("toggle", (e) => {
    const name = e.target.querySelector(".node-name strong")?.textContent;
    if (!name) return;
    if (e.target.open) openRows.add(name);
    else openRows.delete(name);
  }, true);
  const redraw = () => {
    draw();
    table.querySelectorAll("details.node").forEach((row) => {
      if (openRows.has(row.querySelector(".node-name strong")?.textContent)) row.open = true;
    });
  };

  redraw();
  refreshMesh();
  return subscribe((reason) => {
    if (reason === "mesh" || reason === "state") redraw();
  });
}
