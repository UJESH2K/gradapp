// The home screen's one piece of theatre: the mesh drawn as it is right now.
// This machine sits in the middle; every machine the coordinator knows orbits
// it. Links glow while weights are moving and stay still otherwise, so the
// picture is information, not decoration.

const NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function stateOf(node) {
  if (!node.active || node.liveness === "offline") return "off";
  if ((node.active_batches || 0) > 0 || node.phase === "training") return "busy";
  return "on";
}

export function constellation() {
  const root = svg("svg", { viewBox: "-160 -160 320 320", class: "constellation", role: "img" });
  const rings = svg("g", { class: "c-rings" });
  for (const r of [70, 128]) rings.append(svg("circle", { r, class: "c-ring" }));
  const links = svg("g", { class: "c-links" });
  const peers = svg("g", { class: "c-peers" });
  const core = svg("g", { class: "c-core" });
  const pulse = svg("circle", { r: 22, class: "c-pulse" });
  const coreDot = svg("circle", { r: 18, class: "c-core-dot" });
  const coreTitle = svg("title");
  core.append(coreTitle, pulse, coreDot);
  root.append(rings, links, peers, core);

  const wrap = document.createElement("figure");
  wrap.className = "constellation-wrap";
  const caption = document.createElement("figcaption");
  caption.className = "constellation-caption";
  wrap.append(root, caption);

  let last = "";

  function update({ agent, host, mesh, hardware }) {
    const hosting = host?.state === "live";
    const contributing = agent && !["idle", "error"].includes(agent.state);
    const myNode = agent?.nodeId;
    const all = (mesh?.nodes || []).filter((node) => node.node_id !== myNode).slice(0, 12);
    const gpu = hardware?.detect?.facts?.gpus?.[0]?.name || hardware?.detect?.facts?.hostname || "This computer";

    const coreState = agent?.state === "training" ? "busy" : contributing || hosting ? "on" : "off";
    const signature = JSON.stringify([coreState, gpu, all.map((n) => [n.node_id, stateOf(n), n.display_name])]);
    if (signature === last) return;
    last = signature;

    root.setAttribute("aria-label", `${all.length + 1} machine${all.length ? "s" : ""} in view`);
    core.setAttribute("data-state", coreState);
    wrap.toggleAttribute("data-empty", coreState === "off" && all.length === 0);
    coreTitle.textContent = `${gpu} (this computer)`;
    caption.textContent = all.length
      ? `This computer and ${all.length} other machine${all.length === 1 ? "" : "s"}`
      : coreState === "off"
        ? gpu
        : `${gpu}, waiting for others`;

    links.replaceChildren();
    peers.replaceChildren();
    const inner = Math.min(all.length, 5);
    all.forEach((node, index) => {
      const onInner = index < inner;
      const count = onInner ? inner : all.length - inner;
      const slot = onInner ? index : index - inner;
      const radius = onInner ? 70 : 128;
      const angle = -Math.PI / 2 + (slot / Math.max(count, 1)) * Math.PI * 2 + (onInner ? 0 : Math.PI / count);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const state = stateOf(node);

      links.append(svg("line", { x1: 0, y1: 0, x2: x.toFixed(1), y2: y.toFixed(1), class: `c-link is-${state}` }));
      const group = svg("g", { class: `c-peer is-${state}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
      const title = svg("title");
      title.textContent = `${node.display_name || node.node_id} · ${node.gpu || node.backend} · ${state === "busy" ? "training" : state === "on" ? "online" : "offline"}`;
      group.append(title, svg("circle", { r: 9, class: "c-peer-dot" }));
      const label = svg("text", { y: y < -1 ? -15 : 22, class: "c-label", "text-anchor": "middle" });
      const name = node.display_name || node.node_id;
      label.textContent = name.length > 14 ? name.slice(0, 13) + "…" : name;
      group.append(label);
      peers.append(group);
    });
  }

  return { el: wrap, update, destroy() {} };
}
