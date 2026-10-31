import { h, clear, icon, button, busy, field, toast, pill, emptyState } from "../ui.js";
import { store, subscribe } from "../store.js";

const STEP_LABELS = {
  python: "Python",
  prepare: "Agent",
  detect: "GPU",
  install: "PyTorch",
  verify: "Test kernel",
  join: "Join",
  contribute: "Contributing",
};

function stepper(agent) {
  const steps = agent.steps || Object.keys(STEP_LABELS);
  const current = steps.indexOf(agent.step);
  const failed = agent.state === "error";
  return h(
    "ol",
    { class: "stepper", "aria-label": "Joining progress" },
    steps.map((step, index) => {
      const state = index < current || (agent.step === "contribute" && !failed) ? "done" : index === current ? (failed ? "failed" : "active") : "todo";
      return h("li", { class: `step is-${state}` }, h("span", { class: "step-dot" }, state === "done" ? icon("check", 12) : state === "failed" ? icon("x", 12) : null), h("span", { class: "step-label" }, STEP_LABELS[step] || step));
    })
  );
}

function logTail(lines) {
  return h(
    "pre",
    { class: "log-tail", tabindex: "0", "aria-label": "Agent output" },
    lines.map((entry) => h("span", { class: `log-line is-${entry.level}` }, entry.line + "\n"))
  );
}

export function renderContribute(root) {
  let meshes = null;
  let scanning = false;
  let scanNote = "";
  let manualOpen = null;

  const live = h("section", { class: "panel" });
  const finder = h("section", { class: "panel" });
  const manualAddress = h("input", { class: "input", placeholder: "192.168.1.20, gradmesh.local or an invite link", spellcheck: false, autocomplete: "off" });
  const manualToken = h("input", { class: "input", placeholder: "Only if the host did not share it automatically", spellcheck: false, autocomplete: "off", type: "password" });

  clear(
    root,
    h("header", { class: "page-head" }, h("h1", {}, "Contribute this GPU"), h("p", { class: "lede" }, "GradApp installs the PyTorch build this GPU needs into a private folder, proves it runs, and joins. Nothing is installed system-wide.")),
    live,
    finder
  );

  async function join(mesh, btn) {
    let target = mesh;
    if (!target.token) {
      const token = manualToken.value.trim();
      if (!token) {
        manualToken.focus();
        toast("This host did not share its token. Paste it from the host's Invite page.", "error");
        return;
      }
      target = { ...target, token };
    }
    await busy(btn, () => window.gradapp.join(target));
  }

  async function scan() {
    scanning = true;
    scanNote = "Looking on this network";
    renderFinder();
    const result = await window.gradapp.discover();
    scanning = false;
    meshes = result.ok ? result.meshes : [];
    scanNote = result.ok ? "" : result.error;
    renderFinder();
  }

  function renderFinder() {
    const agent = store.app?.agent;
    const active = agent && !["idle", "error"].includes(agent.state);
    finder.hidden = Boolean(active);
    if (active) return;

    const list = h("div", { class: "mesh-list" });
    if (meshes === null || (scanning && !meshes?.length)) {
      list.append(h("div", { class: "mesh-item is-loading" }, h("span", { class: "spinner" }), h("span", {}, scanNote || "Looking on this network")));
    } else if (!meshes.length) {
      list.append(emptyState("No mesh found on this network", "Ask the host to open GradApp and press Host a mesh, or type their address below. Both machines need to be on the same Wi-Fi or LAN."));
    } else {
      for (const mesh of meshes) {
        const btn = button(mesh.local ? "Join (this computer)" : "Join", { kind: "primary", small: true });
        btn.addEventListener("click", () => join(mesh, btn));
        list.append(
          h(
            "div",
            { class: "mesh-item" },
            icon("wifi", 18),
            h(
              "div",
              { class: "mesh-main" },
              h("strong", {}, mesh.meshName || (mesh.local ? "Mesh on this computer" : `Mesh at ${mesh.hostname}`)),
              h("span", { class: "dim" }, `${mesh.hostname} · GradMesh ${mesh.version} · ${mesh.nodesActive ?? 0} online${mesh.token ? "" : " · token needed"}`)
            ),
            btn
          )
        );
      }
    }

    const rescan = button(scanning ? "Scanning" : "Scan again", { kind: "ghost", iconName: "refresh", small: true, disabled: scanning, onClick: scan });
    const connect = button("Connect", { kind: "secondary" });
    connect.addEventListener("click", () =>
      busy(connect, async () => {
        const address = manualAddress.value.trim();
        if (!address) {
          manualAddress.focus();
          return null;
        }
        const result = await window.gradapp.resolve(address);
        if (!result.ok) return result;
        await join(result.mesh, connect);
        return null;
      })
    );

    clear(
      finder,
      h("div", { class: "panel-head" }, h("h2", {}, "Meshes nearby"), rescan),
      list,
      h(
        "details",
        {
          class: "manual",
          open: manualOpen ?? (meshes !== null && !meshes.length),
          ontoggle: (e) => (manualOpen = e.currentTarget.open),
        },
        h("summary", {}, "Enter an address"),
        h(
          "form",
          {
            class: "manual-form",
            onsubmit: (e) => {
              e.preventDefault();
              connect.click();
            },
          },
          field("Host address", manualAddress, "What the host's GradApp shows on its Invite page."),
          field("Mesh token", manualToken),
          h("div", { class: "row" }, connect)
        )
      )
    );
  }

  function renderLive() {
    const agent = store.app?.agent;
    if (!agent || agent.state === "idle") {
      live.hidden = true;
      return;
    }
    live.hidden = false;
    const tone = { online: "live", training: "busy", starting: "info", reconnecting: "warn", stopping: "neutral", error: "danger" }[agent.state] || "neutral";
    const label = { online: "Contributing", training: "Training", starting: "Joining", reconnecting: "Reconnecting", stopping: "Leaving", error: "Stopped" }[agent.state];
    const lines = store.logs.filter((entry) => entry.source === "agent").slice(-40);
    const tail = lines.length ? logTail(lines) : null;
    const where = agent.mesh?.coordinator && /\/\/(127\.0\.0\.1|localhost)[:/]/.test(agent.mesh.coordinator) ? "Hosted on this computer" : agent.mesh?.coordinator || "";
    clear(
      live,
      h(
        "div",
        { class: "panel-head" },
        h("div", {}, h("h2", {}, agent.mesh?.meshName || agent.mesh?.hostname || "Mesh"), h("p", { class: "dim" }, where)),
        pill(label, tone)
      ),
      stepper(agent),
      h("p", { class: agent.state === "error" ? "callout callout-danger" : "status-detail" }, agent.detail || ""),
      agent.fix ? h("code", { class: "block" }, agent.fix) : null,
      h(
        "div",
        { class: "stats-inline" },
        agent.gpu ? h("span", {}, icon("chip", 15), agent.gpu) : null,
        agent.shards ? h("span", {}, `${agent.shards} shard${agent.shards === 1 ? "" : "s"} delivered`) : null
      ),
      tail,
      h(
        "div",
        { class: "row" },
        agent.state === "error"
          ? button("Try again", {
              kind: "primary",
              iconName: "refresh",
              onClick: (e) =>
                busy(e.currentTarget, async () => {
                  // A rejected token usually means the host rotated it: fetch the current one first.
                  let target = agent.mesh;
                  if (/token/i.test(agent.detail || "")) {
                    const fresh = await window.gradapp.resolve(agent.mesh.coordinator);
                    if (fresh.ok && fresh.mesh.token) target = { ...agent.mesh, token: fresh.mesh.token };
                    else if (fresh.ok) return { ok: false, error: "The host did not share a new token. Paste it from the host's Invite page under Enter an address." };
                  }
                  return window.gradapp.join(target);
                }),
            })
          : button("Stop contributing", { kind: "secondary", iconName: "stop", onClick: (e) => busy(e.currentTarget, () => window.gradapp.leave()) }),
        agent.state === "error" ? button("Choose another mesh", { kind: "ghost", onClick: (e) => busy(e.currentTarget, () => window.gradapp.leave()) }) : null
      )
    );
    if (tail) tail.scrollTop = tail.scrollHeight;
  }

  renderLive();
  renderFinder();
  scan();

  // Invite links (gradapp://join?...) arrive here pre-filled.
  const pending = store.pendingInvite;
  store.pendingInvite = null;
  (pending ? Promise.resolve(pending) : window.gradapp.takeInvite()).then((invite) => {
    if (invite) {
      manualAddress.value = invite.coordinator;
      if (invite.token) manualToken.value = invite.token;
      manualOpen = true;
      renderFinder();
      toast("Invite received. Press Connect to join.");
    }
  });

  let throttle = 0;
  const off = subscribe((reason) => {
    if (reason === "state") {
      renderLive();
      renderFinder();
    } else if (reason === "log" && Date.now() - throttle > 250) {
      throttle = Date.now();
      renderLive();
    }
  });
  return off;
}
