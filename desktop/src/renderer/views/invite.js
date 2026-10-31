import { h, clear, button, busy, copyField, emptyState, toast } from "../ui.js";
import { store, subscribe } from "../store.js";

export function renderInvite(root) {
  let info = null;

  async function load() {
    info = store.app?.host?.state === "live" ? await window.gradapp.invite() : null;
    draw();
  }

  function draw() {
    const host = store.app?.host;
    if (!host || host.state !== "live") {
      clear(
        root,
        h("header", { class: "page-head" }, h("h1", {}, "Invite machines")),
        emptyState(
          host?.state === "starting" ? "Starting the mesh…" : "Host a mesh to invite machines",
          host?.state === "starting" ? host.detail : "Machines on your network join the mesh this computer hosts.",
          host?.state === "starting" ? null : button("Host a mesh", { kind: "primary", iconName: "mesh", onClick: (e) => busy(e.currentTarget, () => window.gradapp.host()) })
        )
      );
      return;
    }
    if (!info) return;
    const rotate = button("Rotate token", { kind: "ghost", iconName: "refresh", small: true });
    rotate.addEventListener("click", () =>
      busy(rotate, async () => {
        const result = await window.gradapp.rotateToken();
        if (result.ok) {
          toast("New token issued. Every machine was disconnected and must rejoin.");
          await load();
        }
        return result;
      })
    );

    clear(
      root,
      h("header", { class: "page-head" }, h("h1", {}, "Invite machines"), h("p", { class: "lede" }, "Anyone on this network can join. Their GradApp usually finds this mesh by itself; these are for when it does not.")),
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "With GradApp"),
        h("p", { class: "dim" }, "On the other machine: Contribute this GPU → Enter an address. Or send them the invite link, which opens GradApp ready to join."),
        h("div", { class: "kv" }, h("span", { class: "kv-label" }, "Address"), copyField(info.coordinator.replace(/^http:\/\//, "").replace(/:\d+$/, ""), { label: "Address" })),
        h("div", { class: "kv" }, h("span", { class: "kv-label" }, "Invite link"), copyField(info.invite, { secret: true, label: "Invite link" })),
        h("div", { class: "kv" }, h("span", { class: "kv-label" }, "Mesh token"), copyField(info.token, { secret: true, label: "Token" }))
      ),
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "Without GradApp"),
        info.beacon === "ok"
          ? [
              h("p", { class: "dim" }, "Paste one line into a terminal on the machine with the GPU. It installs into ~/.gradmesh/agent and nothing else."),
              h("div", { class: "kv" }, h("span", { class: "kv-label" }, "Windows"), copyField(`irm ${info.web}/join.ps1 | iex`, { label: "Command" })),
              h("div", { class: "kv" }, h("span", { class: "kv-label" }, "macOS, Linux"), copyField(`curl -fsSL ${info.web}/join.sh | sh`, { label: "Command" })),
              h("div", { class: "kv" }, h("span", { class: "kv-label" }, "Join page"), copyField(`${info.web}/join`, { label: "Link" }))
            ]
          : h("p", { class: "callout callout-warn" }, info.beacon || "The join commands are not being served from this computer.")
      ),
      window.gradapp.platform === "win32"
        ? h("p", { class: "callout" }, "If Windows asked whether Python may use the network, choose Allow for private networks; otherwise other machines cannot reach this one.")
        : null,
      h(
        "section",
        { class: "panel panel-quiet" },
        h("div", { class: "panel-head" }, h("h2", {}, "Security"), rotate),
        h("p", { class: "dim" }, "The token lets a machine receive dataset shards. Anyone who can reach this computer's port 3000 can read it, so host only on networks you trust. Rotating it disconnects every machine.")
      )
    );
  }

  draw();
  load();
  return subscribe((reason) => {
    if (reason === "state") {
      const live = store.app?.host?.state === "live";
      if (live && !info) load();
      else if (!live && info) {
        info = null;
        draw();
      } else if (!live) draw();
    }
  });
}
