import { h, clear, button, busy, field, select, toggle, toast } from "../ui.js";
import { store } from "../store.js";

export function renderSettings(root) {
  const s = () => store.app?.settings || {};
  const save = async (patch) => {
    const next = await window.gradapp.setSettings(patch);
    if (store.app) store.app.settings = next;
  };

  const name = h("input", { class: "input", value: s().deviceName || "", maxlength: 60, onchange: (e) => save({ deviceName: e.target.value.trim() }).then(() => toast("Saved")) });
  const coordPort = h("input", { class: "input", type: "number", min: 1024, max: 65535, value: s().coordinatorPort, onchange: (e) => save({ coordinatorPort: Number(e.target.value) || 8000 }) });
  const beaconPort = h("input", { class: "input", type: "number", min: 1024, max: 65535, value: s().beaconPort, onchange: (e) => save({ beaconPort: Number(e.target.value) || 3000 }) });
  const stateDir = h("input", { class: "input", value: s().meshStateDir || "", readonly: true });
  const isLinux = window.gradapp.platform === "linux";
  const version = h("span", { class: "dim" }, `GradApp ${store.app?.version || ""}`);

  const section = (title, ...rows) => h("section", { class: "panel settings-group" }, h("h2", {}, title), rows);
  const line = (label, hint, control) => h("div", { class: "setting" }, h("div", { class: "setting-text" }, h("span", {}, label), hint ? h("span", { class: "dim" }, hint) : null), control);

  clear(
    root,
    h("header", { class: "page-head" }, h("h1", {}, "Settings")),
    section(
      "This computer",
      field("Name in the mesh", name, "What the host sees in its list of machines."),
      field(
        "GPU to use",
        select(
          [
            ["auto", "Automatic (recommended)"],
            ["cuda", "NVIDIA (CUDA)"],
            ["xpu", "Intel Arc (XPU)"],
            ["mps", "Apple Silicon (Metal)"],
            ["cpu", "CPU only"],
          ],
          s().backend,
          (value) => save({ backend: value })
        ),
        "Takes effect the next time this computer joins."
      )
    ),
    section(
      "Running quietly",
      line("Keep running when the window closes", "GradApp stays in the tray and keeps contributing.", toggle(s().closeToTray, (v) => save({ closeToTray: v }))),
      isLinux ? null : line("Open at login", null, toggle(s().startAtLogin, (v) => save({ startAtLogin: v }))),
      line("Start hidden", "Open straight to the tray, without a window.", toggle(s().startHidden, (v) => save({ startHidden: v }))),
      line("Rejoin the last mesh on start", s().lastMesh ? `Last: ${s().lastMesh.meshName || s().lastMesh.hostname || s().lastMesh.coordinator}` : "Join a mesh once to use this.", toggle(s().autoContribute, (v) => save({ autoContribute: v }))),
      line("Host the mesh on start", null, toggle(s().autoHost, (v) => save({ autoHost: v }))),
      line("Notifications", "Only when something needs you or a join finishes, and never while GradApp is in front.", toggle(s().notifications, (v) => save({ notifications: v })))
    ),
    section(
      "Appearance",
      field(
        "Theme",
        select(
          [
            ["system", "Match the system"],
            ["dark", "Dark"],
            ["light", "Light"],
          ],
          s().theme,
          (value) => save({ theme: value }).then(() => document.documentElement.setAttribute("data-theme", value))
        )
      )
    ),
    section(
      "Hosting",
      h("div", { class: "form-grid" }, field("Coordinator port", coordPort), field("Join page port", beaconPort)),
      field(
        "Mesh data folder",
        h(
          "div",
          { class: "input-row" },
          stateDir,
          button("Change", {
            kind: "secondary",
            small: true,
            onClick: async () => {
              const folder = await window.gradapp.pickFolder();
              if (folder) {
                stateDir.value = folder;
                await save({ meshStateDir: folder });
                toast("Used the next time you host.");
              }
            },
          })
        ),
        "Datasets, runs and trained weights. Choose a drive with space for your datasets."
      ),
      h("p", { class: "dim" }, "Port changes apply the next time you host or join.")
    ),
    section(
      "About",
      h(
        "div",
        { class: "row" },
        version,
        button("Check for updates", {
          kind: "ghost",
          small: true,
          onClick: (e) =>
            busy(e.currentTarget, async () => {
              const update = await window.gradapp.checkUpdate();
              if (update?.available) {
                toast(`GradApp ${update.latest} is available.`);
                window.gradapp.openExternal(update.url);
              } else toast("You have the latest version.");
            }),
        }),
        button("Open data folder", { kind: "ghost", small: true, iconName: "folder", onClick: () => window.gradapp.openFolder("data") }),
        button("Open agent folder", { kind: "ghost", small: true, iconName: "folder", onClick: () => window.gradapp.openFolder("agent") })
      ),
      line("Quit GradApp", "Stops contributing and hosting.", button("Quit", { kind: "danger", small: true, iconName: "power", onClick: () => window.gradapp.quit() }))
    )
  );
}
