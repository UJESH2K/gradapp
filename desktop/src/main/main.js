"use strict";

/**
 * GradApp main process.
 *
 * Owns everything with side effects: the contributor agent, the host's
 * coordinator, the tray, settings, and the bridge the window talks through.
 * The window is just a view; closing it leaves the app running quietly in the
 * tray (unless Settings say otherwise), which is what a machine lending its GPU
 * overnight wants.
 */

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, Notification, powerMonitor, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const settings = require("./settings");
const { PATHS, IS_MAC, IS_WINDOWS, assetsDir, engineDir, ensureDir } = require("./paths");
const { Agent } = require("./agent");
const { Host } = require("./host");
const api = require("./api");
const network = require("./network");
const { findPython, installHint, autoInstallPython } = require("./python");
const { run } = require("./proc");
const { checkForUpdate } = require("./updates");

const PROTOCOL = "gradapp";
const DEV = process.argv.includes("--dev");
const SMOKE = process.env.GRADAPP_SMOKE === "1";

let win = null;
let tray = null;
let quitting = false;
let pendingInvite = null;
let hardwareCache = null;
let events = null;

const agent = new Agent();
const host = new Host();
const logBuffer = [];
const LOG_LIMIT = 1500;
let logStream = null;

// ---------------------------------------------------------------------------
// One instance, invite links
// ---------------------------------------------------------------------------

// A separate profile (tests, or two copies side by side on one machine).
if (process.env.GRADAPP_PROFILE) app.setPath("userData", path.resolve(process.env.GRADAPP_PROFILE));

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function inviteFromArgv(argv) {
  return argv.find((value) => typeof value === "string" && value.toLowerCase().startsWith(`${PROTOCOL}:`)) || null;
}

app.on("second-instance", (_event, argv) => {
  const invite = inviteFromArgv(argv);
  if (invite) handleInvite(invite);
  showWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleInvite(url);
});

function handleInvite(url) {
  const parsed = network.parseAddress(url, portOptions());
  if (!parsed) return;
  pendingInvite = parsed;
  send("invite", parsed);
  showWindow();
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function appendLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_LIMIT) logBuffer.splice(0, logBuffer.length - LOG_LIMIT);
  send("log", entry);
  try {
    if (!logStream) {
      ensureDir(PATHS.logs);
      logStream = fs.createWriteStream(path.join(PATHS.logs, "gradapp.log"), { flags: "a" });
    }
    logStream.write(`${new Date(entry.at).toISOString()} [${entry.source}] ${entry.level}: ${entry.line}\n`);
  } catch {
    // logging must never take the app down
  }
}

function note(line, level = "info") {
  appendLog({ at: Date.now(), source: "app", level, line });
}

agent.on("log", appendLog);
host.on("log", appendLog);

// ---------------------------------------------------------------------------
// State fan-out
// ---------------------------------------------------------------------------

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function portOptions() {
  return { port: settings.get("coordinatorPort"), webPort: settings.get("beaconPort") };
}

/** The mesh this app is looking at: its own when hosting, else the one it contributes to. */
function meshTarget() {
  const hosted = host.target();
  if (hosted) return hosted;
  if (agent.target?.token && agent.status.state !== "idle") return agent.target;
  // The last mesh joined, so its machines and runs stay visible between
  // sessions. Never a mesh on this computer that is not running any more.
  const last = settings.get("lastMesh");
  return last?.token && !last.local ? last : null;
}

function appState() {
  return {
    agent: agent.snapshot(),
    host: host.snapshot(),
    target: (() => {
      const target = meshTarget();
      return target
        ? { coordinator: target.lanCoordinator || target.coordinator, web: target.web, meshName: target.meshName, local: Boolean(target.local) }
        : null;
    })(),
    settings: settings.get(),
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  };
}

let stateTimer = null;
function pushState() {
  // Coalesce bursts (a pip install prints hundreds of lines a second).
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    send("state", appState());
    refreshTray();
  }, 80);
}

agent.on("status", pushState);
host.on("status", (status) => {
  pushState();
  if (status.state === "live" || status.state === "idle") events?.restart();
});

agent.on("transition", (_from, to, status) => {
  if (!settings.get("notifications")) return;
  if (to === "online" && _from === "starting") notify("Contributing", `${status.gpu || "This machine"} joined ${status.mesh?.meshName || "the mesh"}.`);
  if (to === "error") notify("GradApp needs you", status.detail || "The agent stopped.");
});

function notify(title, body) {
  if (!Notification.isSupported()) return;
  // Quiet by design: only while the window is not already in front.
  if (win && win.isVisible() && win.isFocused()) return;
  new Notification({ title, body, silent: true, icon: iconPath("icon.png") }).show();
}

// ---------------------------------------------------------------------------
// Window and tray
// ---------------------------------------------------------------------------

function iconPath(name) {
  return path.join(assetsDir(), name);
}

function createWindow({ show = true } = {}) {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: "GradApp",
    icon: iconPath("icon.png"),
    backgroundColor: dark ? "#07080b" : "#f6f7fb",
    titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 16, y: 18 },
    titleBarOverlay: IS_MAC
      ? undefined
      : { color: "#00000000", symbolColor: dark ? "#98a2b6" : "#5b6375", height: 44 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
      devTools: DEV || !app.isPackaged,
    },
  });

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (show) win.show();
    if (DEV) win.webContents.openDevTools({ mode: "detach" });
  });

  win.on("close", (event) => {
    if (!quitting && settings.get("closeToTray") && tray) {
      event.preventDefault();
      win.hide();
      if (IS_MAC) app.dock?.hide();
    }
  });
  win.on("closed", () => {
    win = null;
  });

  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  return win;
}

function showWindow() {
  if (!win) createWindow();
  if (IS_MAC) app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayImage(active) {
  if (IS_MAC) {
    const image = nativeImage.createFromPath(iconPath(active ? "trayActiveTemplate.png" : "trayTemplate.png"));
    image.setTemplateImage(true);
    return image;
  }
  return nativeImage.createFromPath(iconPath(active ? "tray-active.png" : "tray.png"));
}

function trayLabel() {
  const a = agent.status;
  const h = host.status;
  const parts = [];
  if (h.state === "live") parts.push(`Hosting ${h.meshName || "a mesh"}`);
  else if (h.state === "starting") parts.push("Starting the mesh");
  if (a.state === "training") parts.push("Training");
  else if (a.state === "online") parts.push("Contributing");
  else if (a.state === "starting") parts.push("Joining");
  else if (a.state === "reconnecting") parts.push("Reconnecting");
  else if (a.state === "error") parts.push("Needs attention");
  return parts.length ? parts.join(" · ") : "Idle";
}

function refreshTray() {
  if (!tray) return;
  const contributing = !["idle", "error"].includes(agent.status.state);
  const hosting = ["live", "starting"].includes(host.status.state);
  tray.setImage(trayImage(contributing || hosting));
  tray.setToolTip(`GradApp: ${trayLabel()}`);
  const last = settings.get("lastMesh");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayLabel(), enabled: false },
      { type: "separator" },
      { label: "Open GradApp", click: showWindow },
      contributing
        ? { label: "Stop contributing", click: () => agent.stop() }
        : {
            label: last ? `Contribute to ${last.meshName || last.hostname || "last mesh"}` : "Contribute this GPU…",
            click: () => (last ? startContributing(last) : (showWindow(), send("navigate", "contribute"))),
          },
      hosting
        ? { label: "Stop hosting", click: () => host.stop() }
        : { label: "Host a mesh", click: () => startHosting() },
      { type: "separator" },
      { label: "Quit GradApp", click: () => quit() },
    ])
  );
}

function createTray() {
  try {
    tray = new Tray(trayImage(false));
  } catch (error) {
    note(`tray unavailable: ${error.message}`, "warn");
    tray = null;
    return;
  }
  tray.on("click", () => (IS_MAC ? tray.popUpContextMenu() : showWindow()));
  tray.on("double-click", showWindow);
  refreshTray();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function startContributing(target) {
  const s = settings.get();
  if (!target?.coordinator || !target?.token) throw new Error("A mesh address and token are needed.");
  const clean = {
    coordinator: target.coordinator,
    web: target.web || null,
    token: target.token,
    meshName: target.meshName || null,
    meshId: target.meshId || null,
    hostname: target.hostname || null,
    local: Boolean(target.local),
  };
  // A mesh hosted on this computer is reached at 127.0.0.1 and only exists
  // while hosting, so it is not remembered as "the last mesh".
  if (target.local) settings.set({ onboarded: true });
  else settings.set({ lastMesh: clean, onboarded: true });
  agent.start(clean, { name: s.deviceName, backend: s.backend });
  pushState();
  return true;
}

async function startHosting() {
  const s = settings.get();
  await host.start({ port: s.coordinatorPort, webPort: s.beaconPort, stateDir: s.meshStateDir });
  settings.set({ onboarded: true });
  return host.snapshot();
}

async function quit() {
  quitting = true;
  events?.stop();
  await Promise.allSettled([agent.stop(), host.stop()]);
  app.quit();
}

async function hardware(refresh = false) {
  if (hardwareCache && !refresh) return hardwareCache;
  const python = await findPython({ refresh });
  const base = { python, hint: python ? null : installHint() };
  if (!python) return (hardwareCache = { ...base, detect: null });
  const result = await run(python.command, [...python.args, path.join(engineDir(), "setup_env.py"), "detect", "--json"], {
    timeoutMs: 45000,
    cwd: engineDir(),
    env: { PYTHONDONTWRITEBYTECODE: "1" },
  });
  let detect = null;
  try {
    detect = JSON.parse(result.stdout);
  } catch {
    note(`hardware detection failed: ${(result.stderr || result.error || "").slice(0, 400)}`, "warn");
  }
  hardwareCache = { ...base, detect };
  return hardwareCache;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

function registerIpc() {
  handle("state:get", () => appState());
  handle("logs:get", () => logBuffer.slice(-600));
  handle("logs:open", () => shell.openPath(PATHS.logs));
  handle("invite:take", () => {
    const invite = pendingInvite;
    pendingInvite = null;
    return invite;
  });

  handle("hardware:get", (refresh) => hardware(Boolean(refresh)));
  handle("python:install", async () => {
    const result = await autoInstallPython((line) => note(line));
    hardwareCache = null;
    return result;
  });

  handle("settings:set", (patch) => {
    const next = settings.set(patch);
    if ("startAtLogin" in patch || "startHidden" in patch) applyLoginItem();
    if ("theme" in patch) nativeTheme.themeSource = next.theme;
    pushState();
    return next;
  });

  handle("mesh:discover", async () => {
    const meshes = await network.discover({
      ...portOptions(),
      onProgress: (progress) => send("discover:progress", progress),
    });
    return { ok: true, meshes };
  });
  handle("mesh:resolve", async (address) => {
    const parsed = network.parseAddress(address, portOptions());
    if (!parsed) return { ok: false, error: "That does not look like an address." };
    const health = await network.getJson(`${parsed.coordinator}/health`, 4000).catch(() => null);
    if (!health || health.status !== "ok") {
      return { ok: false, error: `No GradMesh answered at ${parsed.coordinator}. Check the address and that both machines are on the same network.` };
    }
    const invite = parsed.token ? { token: parsed.token, web: parsed.web } : await network.readInvite(parsed.hostname, portOptions().webPort);
    return {
      ok: true,
      mesh: { ...parsed, ...invite, token: parsed.token || invite.token, meshId: health.mesh_id, version: health.version, nodesActive: health.nodes_active },
    };
  });

  handle("agent:start", (target) => startContributing(target));
  handle("agent:stop", () => agent.stop());
  handle("agent:contributeLocal", () => {
    const target = host.target();
    if (!target) throw new Error("Start hosting first.");
    return startContributing({ ...target, meshName: host.status.meshName });
  });

  handle("host:start", () => startHosting());
  handle("host:stop", () => host.stop());
  handle("host:repair", () => host.repair());
  handle("host:rotate", async () => {
    const token = await host.rotateToken();
    return { ok: true, token };
  });
  handle("host:reveal", () => {
    const status = host.snapshot();
    if (status.state !== "live") return null;
    const invite = `${PROTOCOL}://join?server=${encodeURIComponent(status.coordinator)}&token=${encodeURIComponent(status.token)}&name=${encodeURIComponent(status.meshName || "GradMesh")}`;
    return { token: status.token, coordinator: status.coordinator, web: status.web, invite, beacon: status.beacon };
  });

  handle("api", (method, route, body) => api.call(meshTarget(), method, route, body));
  handle("datasets:upload", async (makeDefault) => {
    const target = meshTarget();
    if (!target) throw new Error("Not connected to a mesh.");
    const pick = await dialog.showOpenDialog(win, {
      title: "Choose a YOLO dataset (.zip)",
      properties: ["openFile"],
      filters: [{ name: "Dataset archive", extensions: ["zip"] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    const file = pick.filePaths[0];
    note(`uploading ${path.basename(file)}`);
    return api.uploadDataset(target, file, path.basename(file, ".zip"), Boolean(makeDefault));
  });
  handle("runs:artifact", async (runId, name) => {
    const target = meshTarget();
    if (!target) throw new Error("Not connected to a mesh.");
    const pick = await dialog.showSaveDialog(win, {
      title: "Save trained weights",
      defaultPath: path.join(app.getPath("downloads"), `${(name || runId).replace(/[^\w.-]+/g, "-")}.pt`),
      filters: [{ name: "PyTorch weights", extensions: ["pt"] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
    const result = await api.saveArtifact(target, runId, pick.filePath);
    if (result.ok) shell.showItemInFolder(pick.filePath);
    return result;
  });

  handle("open:external", (url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
    return true;
  });
  handle("open:folder", (which) => {
    const map = { data: PATHS.home, agent: PATHS.agentHome, mesh: settings.get("meshStateDir"), logs: PATHS.logs };
    const target = map[which];
    if (target) {
      ensureDir(target);
      shell.openPath(target);
    }
    return true;
  });
  handle("pick:folder", async () => {
    const pick = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
    return pick.canceled ? null : pick.filePaths[0];
  });
  handle("update:check", () => checkForUpdate(app.getVersion()));
  handle("app:quit", () => quit());
  handle("window:hide", () => win?.hide());
}

function applyLoginItem() {
  if (process.platform === "linux") return; // set up by the desktop entry instead
  const s = settings.get();
  app.setLoginItemSettings({
    openAtLogin: Boolean(s.startAtLogin),
    openAsHidden: Boolean(s.startHidden),
    args: s.startHidden ? ["--hidden"] : [],
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  if (IS_WINDOWS) app.setAppUserModelId("dev.gradmesh.gradapp");
  Menu.setApplicationMenu(
    IS_MAC
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ])
      : null
  );
  nativeTheme.themeSource = settings.get("theme") || "system";
  registerIpc();

  const hidden = process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden || settings.get("startHidden");
  createTray();
  createWindow({ show: !hidden || !tray });
  if (hidden && IS_MAC && tray) app.dock?.hide();

  const invite = inviteFromArgv(process.argv);
  if (invite) handleInvite(invite);

  events = api.followEvents(meshTarget, (event) => send("mesh:event", event));

  // Pick up where it left off, quietly.
  const s = settings.get();
  if (s.autoHost) startHosting().catch((error) => note(`auto-host failed: ${error.message}`, "warn"));
  if (s.autoContribute && s.lastMesh?.token) {
    startContributing(s.lastMesh).catch((error) => note(`auto-contribute failed: ${error.message}`, "warn"));
  }

  // A laptop that slept has a stale connection; the agent's own retry loop
  // handles the rest.
  powerMonitor.on("resume", () => {
    note("resumed from sleep");
    events?.restart();
  });

  if (s.checkUpdates && !SMOKE) {
    setTimeout(async () => {
      const update = await checkForUpdate(app.getVersion());
      if (update?.available) send("update", update);
    }, 8000);
  }

  if (SMOKE) {
    // CI and local smoke test: render, report, exit.
    setTimeout(async () => {
      const result = await win.webContents.executeJavaScript("document.querySelector('#app')?.dataset.ready || 'no'");
      console.log(`SMOKE ${result === "yes" ? "ok" : "failed"}`);
      quitting = true;
      app.exit(result === "yes" ? 0 : 1);
    }, 4000);
  }
});

app.on("activate", showWindow);
app.on("window-all-closed", () => {
  if (!tray || !settings.get("closeToTray")) quit();
});
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quit();
});
