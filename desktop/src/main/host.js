"use strict";

/**
 * Host a mesh from this machine: `npm run dev` without Node, a repo or a terminal.
 *
 * 1. Build the control-plane environment with GradMesh's own installer
 *    (setup_env.py install --plane control --host). Seconds, no PyTorch.
 * 2. Start the FastAPI coordinator from the bundled engine. The mesh is live
 *    and other machines can join from here on.
 * 3. Serve the join surface on port 3000 (see beacon.js).
 * 4. In the background, download the base checkpoints and install the
 *    training plane (PyTorch), which aggregation needs before a run can start.
 *
 * If a GradMesh coordinator is already running on this machine (someone ran
 * `npm run dev` in the Gradmesh repo), GradApp attaches to it instead of
 * starting a second one on a port that is taken.
 */

const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const { PATHS, engineDir, ensureDir, venvPython } = require("./paths");
const { findPython } = require("./python");
const { run, start, stopTree } = require("./proc");
const { startBeacon } = require("./beacon");
const { download, getJson, primaryLanAddress, readInvite } = require("./network");

const BASE_MODELS = [
  { name: "yolov8n.pt", url: "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt" },
  { name: "yolo11n.pt", url: "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt" },
];

class Host extends EventEmitter {
  constructor() {
    super();
    this.coordinatorProcess = null;
    this.beacon = null;
    this.stopping = false;
    this.background = null;
    this.reset();
  }

  reset() {
    this.status = {
      state: "idle", // idle | starting | live | stopping | error
      attached: false,
      detail: "",
      coordinator: null,
      web: null,
      token: null,
      meshId: null,
      meshName: null,
      version: null,
      trainingPlane: "pending", // pending | installing | ready | failed
      models: "pending", // pending | downloading | ready | failed
      torchReady: false,
      beacon: null, // null | "ok" | error text
      error: null,
      startedAt: null,
    };
  }

  snapshot() {
    return { ...this.status };
  }

  update(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.snapshot());
  }

  log(line, level = "info", source = "host") {
    this.emit("log", { at: Date.now(), source, level, line });
  }

  /** Connection details for the API client and the agent when this machine also contributes. */
  target() {
    if (!this.status.token || !this.status.coordinator) return null;
    return {
      coordinator: `http://127.0.0.1:${this.port}`,
      lanCoordinator: this.status.coordinator,
      web: this.status.web,
      token: this.status.token,
      meshId: this.status.meshId,
      meshName: this.status.meshName,
      local: true,
    };
  }

  readToken() {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(this.stateDir, "coordinator.json"), "utf8"));
      return { token: state.mesh_token || null, meshName: state.mesh_name || "GradMesh" };
    } catch {
      return { token: null, meshName: null };
    }
  }

  /** Run setup_env.py to completion, streaming its lines into the log. */
  installPlane(python, plane) {
    return new Promise((resolve) => {
      const child = start(
        python.command,
        [
          ...python.args,
          path.join(engineDir(), "setup_env.py"),
          "install",
          "--venv",
          PATHS.hostVenv,
          "--plane",
          plane,
          "--host",
          "--state",
          PATHS.hostSetup,
        ],
        {
          cwd: engineDir(),
          env: { PYTHONDONTWRITEBYTECODE: "1" },
          onLine: (line, stream) => {
            this.log(line, stream === "stderr" ? "warn" : "info", `setup:${plane}`);
            const match = line.match(/installing (\S+)/);
            if (match) this.update({ detail: `Installing ${match[1].replace(/^requirements-|\.txt$/g, "")} packages` });
          },
          onExit: (code) => resolve(code),
        }
      );
      this.installs = (this.installs || new Set()).add(child);
      child.on("exit", () => this.installs.delete(child));
    });
  }

  async waitForHealth(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.stopping) {
      try {
        return await getJson(`http://127.0.0.1:${this.port}/health`, 1500);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    return null;
  }

  startCoordinator() {
    const python = venvPython(PATHS.hostVenv);
    this.log(`starting the coordinator on 0.0.0.0:${this.port}`);
    this.coordinatorProcess = start(
      python,
      [
        "-m",
        "uvicorn",
        "coordinator.app:app",
        "--host",
        "0.0.0.0",
        "--port",
        String(this.port),
        "--log-level",
        "warning",
        "--timeout-keep-alive",
        "75",
      ],
      {
        cwd: engineDir(),
        env: {
          PYTHONDONTWRITEBYTECODE: "1",
          GRADMESH_STATE_DIR: this.stateDir,
          GRADMESH_WEB_PORT: String(this.webPort),
          GRADMESH_COORDINATOR_PORT: String(this.port),
        },
        onLine: (line, stream) => {
          if (/"(POST|GET) \/(heartbeat|get_batch|health|mesh)/.test(line)) return;
          this.log(line, stream === "stderr" && /error|traceback/i.test(line) ? "error" : "info", "coordinator");
        },
        onExit: (code) => {
          this.coordinatorProcess = null;
          if (this.stopping || this.restartingCoordinator) return;
          this.update({ state: "error", error: "coordinator", detail: `The coordinator stopped (exit code ${code}). See Activity.` });
        },
      }
    );
  }

  async start({ port = 8000, webPort = 3000, stateDir = PATHS.defaultMeshState } = {}) {
    if (this.status.state === "live" || this.status.state === "starting") return;
    this.stopping = false;
    this.port = port;
    this.webPort = webPort;
    this.stateDir = ensureDir(stateDir);
    this.reset();
    this.update({ state: "starting", detail: "Checking this machine", startedAt: Date.now() });

    // Already running here? Attach rather than fight over the port.
    try {
      const health = await getJson(`http://127.0.0.1:${port}/health`, 1200);
      if (health?.status === "ok") {
        const invite = await readInvite("127.0.0.1", webPort);
        const ownToken = this.readToken().token;
        const token = invite.token || ownToken;
        if (!token) {
          this.update({
            state: "error",
            error: "port",
            detail: `A GradMesh coordinator is already running on port ${port}, but its token could not be read. Stop it, or change the port in Settings.`,
          });
          return;
        }
        const lan = primaryLanAddress();
        this.update({
          state: "live",
          attached: true,
          detail: "Attached to the GradMesh already running on this machine.",
          coordinator: `http://${lan}:${port}`,
          web: `http://${lan}:${webPort}`,
          token,
          meshId: health.mesh_id,
          version: health.version,
          meshName: invite.meshName || "GradMesh",
          torchReady: Boolean(health.torch_ready),
          trainingPlane: health.torch_ready ? "ready" : "pending",
          models: "ready",
          beacon: invite.kind ? "ok" : null,
        });
        this.log(`attached to the coordinator already on port ${port}`);
        return;
      }
    } catch {
      // Nothing there; start our own.
    }

    const python = await findPython({ refresh: true });
    if (this.stopping) return;
    if (!python) {
      this.update({ state: "error", error: "python-missing", detail: "Python 3.10 to 3.13 was not found." });
      return;
    }

    this.update({ detail: "Preparing the control plane (first time takes a minute)" });
    const controlCode = await this.installPlane(python, "control");
    if (this.stopping) return;
    if (controlCode !== 0) {
      this.update({ state: "error", error: "setup", detail: "Installing the control plane failed. See Activity for the reason." });
      return;
    }

    this.update({ detail: "Starting the coordinator" });
    this.startCoordinator();
    const health = await this.waitForHealth();
    if (this.stopping) return;
    if (!health) {
      this.update({ state: "error", error: "coordinator", detail: "The coordinator did not start. See Activity." });
      return;
    }

    const { token, meshName } = this.readToken();
    const lan = primaryLanAddress();
    this.update({
      state: "live",
      detail: "Mesh is live",
      coordinator: `http://${lan}:${port}`,
      web: `http://${lan}:${webPort}`,
      token,
      meshName,
      meshId: health.mesh_id,
      version: health.version,
      torchReady: Boolean(health.torch_ready),
      trainingPlane: health.torch_ready ? "ready" : "pending",
    });

    try {
      this.beacon = await startBeacon({
        port: webPort,
        info: () => ({
          token: this.readToken().token || this.status.token,
          coordinatorPort: this.port,
          meshName: this.status.meshName,
          meshId: this.status.meshId,
          version: this.status.version,
          lanAddress: primaryLanAddress(),
        }),
      });
      this.update({ beacon: "ok" });
    } catch (error) {
      this.update({ beacon: `Port ${webPort} is busy (${error.code || error.message}). Join commands will not be served; use the invite link.` });
      this.log(`join surface not started: ${error.message}`, "warn");
    }

    this.background = this.finishSetup(python);
  }

  /** Checkpoints and PyTorch, while the mesh is already usable. */
  async finishSetup(python) {
    const modelsDir = ensureDir(path.join(this.stateDir, "models"));
    this.update({ models: "downloading" });
    try {
      for (const model of BASE_MODELS) {
        const target = path.join(modelsDir, model.name);
        if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) continue;
        this.log(`downloading ${model.name}`);
        await download(model.url, target);
        if (this.stopping) return;
      }
      this.update({ models: "ready" });
    } catch (error) {
      this.update({ models: "failed" });
      this.log(`checkpoint download failed: ${error.message}`, "error");
    }

    if (this.status.torchReady) return;
    this.update({ trainingPlane: "installing" });
    const code = await this.installPlane(python, "training");
    if (this.stopping) return;
    if (code !== 0 && code !== 2) {
      this.update({ trainingPlane: "failed" });
      this.log("training plane install failed; runs stay blocked until it succeeds (Retry on the Runs page)", "error");
      return;
    }
    // Only worth a restart if PyTorch really imports in the host venv now;
    // otherwise a restart just drops every connected machine for nothing.
    const probe = await run(venvPython(PATHS.hostVenv), ["-c", "import torch"], { timeoutMs: 120000 });
    if (probe.code !== 0) {
      this.update({ trainingPlane: "failed" });
      this.log("PyTorch is not importable in the host environment; runs stay blocked until the install succeeds", "error");
      return;
    }
    // A coordinator that started before torch existed may have cached the
    // failed import. Restart it once so aggregation sees PyTorch.
    const health = await getJson(`http://127.0.0.1:${this.port}/health`, 2000).catch(() => null);
    if (!health?.torch_ready) {
      this.log("restarting the coordinator so it picks up PyTorch");
      this.restartingCoordinator = true;
      await stopTree(this.coordinatorProcess, 4000);
      this.restartingCoordinator = false;
      this.startCoordinator();
      await this.waitForHealth();
    }
    const after = await getJson(`http://127.0.0.1:${this.port}/health`, 2000).catch(() => null);
    this.update({ trainingPlane: after?.torch_ready ? "ready" : "failed", torchReady: Boolean(after?.torch_ready) });
  }

  /** Try the background part of setup again: checkpoints, then PyTorch. */
  async repair() {
    if (this.status.state !== "live" || this.status.attached) throw new Error("Host a mesh first.");
    if (this.status.trainingPlane === "installing") return this.snapshot();
    const python = await findPython({ refresh: true });
    if (!python) throw new Error("Python 3.10 to 3.13 was not found.");
    this.background = this.finishSetup(python);
    return this.snapshot();
  }

  async rotateToken() {
    const target = this.target();
    if (!target) throw new Error("The mesh is not running.");
    const response = await fetch(`${target.coordinator}/token/rotate`, {
      method: "POST",
      headers: { "X-Mesh-Token": target.token },
    });
    if (!response.ok) throw new Error(`Rotate failed: HTTP ${response.status}`);
    const body = await response.json().catch(() => ({}));
    const token = body.mesh_token || body.token || this.readToken().token;
    this.update({ token });
    return token;
  }

  async stop() {
    this.stopping = true;
    this.update({ state: "stopping", detail: "Stopping the mesh" });
    if (this.beacon) {
      await new Promise((resolve) => this.beacon.close(() => resolve()));
      this.beacon = null;
    }
    for (const child of this.installs || []) await stopTree(child, 2000);
    if (this.coordinatorProcess) await stopTree(this.coordinatorProcess, 4000);
    this.coordinatorProcess = null;
    this.reset();
    this.update({ state: "idle" });
  }
}

module.exports = { Host };
