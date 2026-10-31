import { h, clear, icon, button, busy, fmtBytes, vendorBadge, pill } from "../ui.js";
import { store, subscribe } from "../store.js";
import { constellation } from "../constellation.js";
import { go } from "../router.js";

function agentLine(agent) {
  switch (agent.state) {
    case "online":
      return `Contributing to ${agent.mesh?.meshName || agent.mesh?.hostname || "the mesh"}. Waiting for work.`;
    case "training":
      return agent.detail;
    case "starting":
      return agent.detail || "Joining";
    case "reconnecting":
      return agent.detail;
    case "error":
      return agent.detail || "The agent stopped.";
    default:
      return null;
  }
}

export function renderHome(root) {
  const scene = constellation();
  const deviceCard = h("section", { class: "device" });
  const actions = h("div", { class: "home-actions" });
  const statusLine = h("p", { class: "home-status" });
  const title = h("h1", { class: "home-title" });

  clear(
    root,
    h(
      "div",
      { class: "home" },
      h("div", { class: "home-hero" }, h("div", { class: "home-copy" }, title, statusLine, actions), scene.el),
      deviceCard
    )
  );

  const renderDevice = () => {
    const hw = store.hardware;
    if (!hw) {
      clear(deviceCard, h("div", { class: "device-row" }, h("span", { class: "skeleton", style: { width: "60%" } })));
      return;
    }
    const gpus = hw.detect?.facts?.gpus || [];
    const profile = hw.detect?.profile;
    const facts = hw.detect?.facts;
    const rows = [];
    if (gpus.length) {
      for (const gpu of gpus) {
        rows.push(
          h(
            "div",
            { class: "device-row" },
            icon("chip", 18),
            h("div", { class: "device-main" }, h("strong", {}, gpu.name || "GPU"), h("span", { class: "dim" }, [gpu.memory_mb ? fmtBytes(gpu.memory_mb) : null, gpu.driver ? `driver ${gpu.driver}` : null].filter(Boolean).join(", "))),
            vendorBadge({ nvidia: "cuda", intel: "xpu", apple: "mps" }[gpu.vendor] || "cpu")
          )
        );
      }
    } else {
      rows.push(
        h(
          "div",
          { class: "device-row" },
          icon("chip", 18),
          h("div", { class: "device-main" }, h("strong", {}, "No supported GPU found"), h("span", { class: "dim" }, "This machine can host a mesh and be measured, but it will not receive training work.")),
          vendorBadge("cpu")
        )
      );
    }
    const pythonRow = hw.python
      ? h("span", { class: "dim" }, `Python ${hw.python.version}`)
      : h("span", { class: "warn-text" }, "Python 3.10–3.13 needed");
    clear(
      deviceCard,
      h(
        "div",
        { class: "device-head" },
        h("h2", {}, "This computer"),
        h("div", { class: "device-meta" }, facts ? h("span", { class: "dim" }, `${facts.hostname} · ${facts.os} ${facts.arch} · ${fmtBytes(facts.ram_mb)} RAM`) : null, pythonRow)
      ),
      rows,
      profile?.blocked ? h("p", { class: "callout callout-warn" }, profile.blocked, profile.fix ? h("br") : null, profile.fix || null) : null,
      !hw.python
        ? h(
            "div",
            { class: "callout callout-warn" },
            h("p", {}, hw.hint?.text),
            h("code", { class: "block" }, hw.hint?.command),
            h(
              "div",
              { class: "row" },
              hw.hint?.canAutoInstall
                ? button("Install Python 3.12", {
                    kind: "primary",
                    onClick: (e) =>
                      busy(e.currentTarget, async () => {
                        const result = await window.gradapp.installPython();
                        store.hardware = await window.gradapp.hardware(true);
                        renderDevice();
                        return result;
                      }),
                  })
                : null,
              button("Retry", {
                iconName: "refresh",
                onClick: (e) =>
                  busy(e.currentTarget, async () => {
                    store.hardware = await window.gradapp.hardware(true);
                    renderDevice();
                  }),
              }),
              button("Download Python", { kind: "ghost", iconName: "external", onClick: () => window.gradapp.openExternal(hw.hint?.url) })
            )
          )
        : null
    );
  };

  const renderTop = () => {
    const app = store.app;
    if (!app) return;
    const { agent, host } = app;
    const hosting = host.state === "live";
    const contributing = !["idle", "error"].includes(agent.state);

    title.textContent = hosting
      ? `${host.meshName || "Your mesh"} is live`
      : contributing
        ? agent.state === "training"
          ? "Training"
          : agent.state === "starting"
            ? "Joining"
            : "Contributing"
        : "Pool the GPUs around you";

    const nodes = store.mesh?.metrics?.nodes_active;
    statusLine.textContent =
      agentLine(agent) ||
      (hosting
        ? `${nodes ?? 0} machine${nodes === 1 ? "" : "s"} online. Others join from the Invite page.`
        : host.state === "starting"
          ? host.detail
          : "Lend this machine's GPU to a mesh on your network, or host one and invite the rest.");
    statusLine.classList.toggle("is-error", agent.state === "error" || host.state === "error");

    const items = [];
    if (contributing) {
      items.push(button("Stop contributing", { kind: "secondary", iconName: "stop", onClick: (e) => busy(e.currentTarget, () => window.gradapp.leave()) }));
      items.push(button("Details", { kind: "ghost", onClick: () => go("contribute") }));
    } else {
      items.push(button("Contribute this GPU", { kind: "primary", iconName: "contribute", onClick: () => go("contribute") }));
    }
    if (hosting) {
      items.push(button("Invite machines", { kind: "secondary", iconName: "invite", onClick: () => go("invite") }));
      if (!contributing) {
        items.push(button("Use this machine too", { kind: "ghost", iconName: "plus", onClick: (e) => busy(e.currentTarget, () => window.gradapp.contributeLocal()) }));
      }
    } else if (host.state === "starting") {
      items.push(pill(host.detail || "Starting", "info"));
    } else if (!contributing) {
      items.push(button("Host a mesh", { kind: "secondary", iconName: "mesh", onClick: (e) => busy(e.currentTarget, () => window.gradapp.host()) }));
    }
    if (agent.state === "error") items.push(button("Try again", { kind: "ghost", iconName: "refresh", onClick: () => go("contribute") }));
    clear(actions, items);

    scene.update({ agent, host, mesh: store.mesh, hardware: store.hardware });
  };

  renderDevice();
  renderTop();
  const off = subscribe((reason) => {
    if (reason === "hardware") renderDevice();
    if (reason === "state" || reason === "mesh" || reason === "hardware") renderTop();
  });
  return () => {
    off();
    scene.destroy();
  };
}
