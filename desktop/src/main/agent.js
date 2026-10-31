"use strict";

/**
 * Contribute this machine's GPU to a mesh.
 *
 * This is the one-line join command (`irm .../join.ps1 | iex`) without the
 * terminal: find Python, put the agent files in ~/.gradmesh/agent, and hand over
 * to GradMesh's own installer, `setup_env.py agent`, which detects the GPU,
 * installs the matching PyTorch build, proves a kernel runs, and starts
 * worker.py. GradApp watches its output to show a progress stepper instead of a
 * wall of text, and restarts it if it falls over.
 */

const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const { PATHS, engineDir, ensureDir } = require("./paths");
const { findPython } = require("./python");
const { start, stopTree } = require("./proc");

/** The files a joining machine needs. Mirrors lib/agent.ts in GradMesh. */
const AGENT_FILES = [
  "version.py",
  "hardware.py",
  "setup_env.py",
  "accelerator.py",
  "probe.py",
  "trainers.py",
  "federated_training.py",
  "ultralytics_xpu.py",
  "worker.py",
  "requirements-control.txt",
  "requirements-common.txt",
  "requirements-train-cu130.txt",
  "requirements-train-cu126.txt",
  "requirements-train-cu128.txt",
  "requirements-train-cpu.txt",
  "requirements-xpu.txt",
  "requirements-mps.txt",
];

const STEPS = ["python", "prepare", "detect", "install", "verify", "join", "contribute"];

class Agent extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.target = null;
    this.stopping = false;
    this.restarts = 0;
    this.restartTimer = null;
    this.reset();
  }

  reset() {
    this.status = {
      state: "idle", // idle | starting | online | training | reconnecting | stopping | error
      step: null,
      detail: "",
      gpu: null,
      nodeId: null,
      mesh: null,
      shards: 0,
      startedAt: null,
      error: null,
      fix: null,
    };
  }

  snapshot() {
    return { ...this.status, steps: STEPS, running: Boolean(this.child) };
  }

  update(patch) {
    const before = this.status.state;
    this.status = { ...this.status, ...patch };
    this.emit("status", this.snapshot());
    if (patch.state && patch.state !== before) this.emit("transition", before, patch.state, this.snapshot());
  }

  log(line, level = "info") {
    this.emit("log", { at: Date.now(), source: "agent", level, line });
  }

  /** Copy the agent into ~/.gradmesh/agent: from the host when it serves one, else the bundled copy. */
  async prepareFiles(web) {
    const home = ensureDir(PATHS.agentHome);
    if (web) {
      try {
        const probe = await fetch(`${web}/api/agent/version.py`, { signal: AbortSignal.timeout(3500) });
        if (probe.ok) {
          const files = await Promise.all(
            AGENT_FILES.map(async (file) => {
              const response = await fetch(`${web}/api/agent/${file}`, { signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
              return [file, Buffer.from(await response.arrayBuffer())];
            })
          );
          for (const [file, body] of files) fs.writeFileSync(path.join(home, file), body);
          this.log(`agent files from the host (${web})`);
          return home;
        }
      } catch (error) {
        this.log(`host agent files unavailable (${error.message}); using the bundled agent`, "warn");
      }
    }
    const source = engineDir();
    for (const file of AGENT_FILES) {
      fs.copyFileSync(path.join(source, file), path.join(home, file));
    }
    this.log("agent files from the bundled engine");
    return home;
  }

  /**
   * target: { coordinator, web?, token, meshName?, meshId? }
   * options: { name, backend }
   */
  async start(target, options = {}) {
    if (this.child) await this.stop();
    clearTimeout(this.restartTimer);
    this.stopping = false;
    this.target = target;
    this.options = options;
    this.reset();
    this.update({ state: "starting", step: "python", detail: "Looking for Python", mesh: target, startedAt: Date.now() });

    const python = await findPython({ refresh: true });
    if (this.stopping) return;
    if (!python) {
      this.update({ state: "error", error: "python-missing", detail: "Python 3.10 to 3.13 was not found." });
      return;
    }
    this.log(`Python ${python.version} (${python.machine}) at ${python.executable}`);

    this.update({ step: "prepare", detail: "Preparing the GradMesh agent" });
    let home;
    try {
      home = await this.prepareFiles(target.web);
    } catch (error) {
      this.update({ state: "error", error: "files", detail: `Could not prepare the agent: ${error.message}` });
      return;
    }
    if (this.stopping) return;

    this.update({ step: "detect", detail: "Detecting your GPU" });
    const args = [
      ...python.args,
      path.join(home, "setup_env.py"),
      "agent",
      "--server",
      target.coordinator,
      "--token",
      target.token,
      "--backend",
      options.backend || "auto",
    ];
    if (options.name) args.push("--name", options.name);

    this.lastError = "";
    this.errorRank = 0;
    this.lastFix = "";
    this.child = start(python.command, args, {
      cwd: home,
      env: { GRADMESH_AGENT_HOME: home, GRADMESH_OWNER: options.owner || "" },
      onLine: (line, stream) => this.onLine(line, stream),
      onExit: (code) => this.onExit(code),
    });
  }

  onLine(line, stream) {
    // pip's own retry chatter is noise, not the reason anything failed.
    const pipNoise = /^\s*(WARNING:|Requirement already satisfied|Looking in indexes|Collecting |Downloading |Using cached )/.test(line);
    const level = pipNoise
      ? /^\s*WARNING:/.test(line)
        ? "warn"
        : "info"
      : /error|failed|could not|rejected|traceback/i.test(line)
        ? "error"
        : stream === "stderr"
          ? "warn"
          : "info";
    this.log(line, level);
    const text = line.replace(/^\s+/, "");
    let match;

    if ((match = text.match(/^detected (.+)$/))) {
      this.update({ step: "install", gpu: match[1], detail: "Installing the PyTorch build for this GPU" });
    } else if (/^(creating a Python environment|rebuilding the Python environment)/.test(text)) {
      this.update({ step: "install", detail: "Creating a private Python environment" });
    } else if ((match = text.match(/^installing (\S+)/))) {
      this.update({ step: "install", detail: `Installing ${match[1].replace(/^requirements-|\.txt$/g, "")} packages` });
    } else if ((match = text.match(/^checking that (\S+) actually runs/))) {
      this.update({ step: "verify", detail: `Running a test kernel on ${match[1]}` });
    } else if (/^Contributing this GPU/.test(text)) {
      this.update({ step: "join", detail: "Measuring the device and joining" });
    } else if ((match = text.match(/joined (\S+) as ([0-9a-f]{8,})/))) {
      this.restarts = 0;
      this.update({ state: "online", step: "contribute", nodeId: match[2], detail: "Contributing. Waiting for work." });
    } else if ((match = text.match(/round (\d+) shard (\S+): (\d+) images/))) {
      this.update({ state: "training", step: "contribute", detail: `Training round ${match[1]}: ${match[3]} images` });
    } else if (/finished shard/.test(text)) {
      this.update({ state: "online", shards: this.status.shards + 1, detail: "Shard delivered. Waiting for the next round." });
    } else if (/stopped answering|is unreachable|looking for the coordinator/.test(text)) {
      if (this.status.step === "contribute") this.update({ state: "reconnecting", detail: "The host stopped answering. Reconnecting." });
    } else if (/reachable again|found the coordinator at/.test(text)) {
      if (this.status.step === "contribute") this.update({ state: "online", detail: "Reconnected." });
    } else if (/token was rejected/i.test(text)) {
      this.lastError = "The mesh token was rejected. Ask the host for a fresh invite.";
      this.errorRank = 3;
    } else if ((match = text.match(/pip could not install (\S+)/))) {
      // GradMesh's own summary of an install failure beats any raw pip line.
      this.lastError = `Installing ${match[1].replace(/^requirements-|\.txt\.?$/g, "")} packages failed. Check this computer's internet connection (download.pytorch.org must be reachable), then try again.`;
      this.errorRank = 3;
    } else if (/^(The GPU could not run PyTorch|GradMesh needs|No GradMesh coordinator was found)/.test(text)) {
      this.lastError = text;
      this.errorRank = 3;
    } else if (/No matching distribution|Could not find a version/.test(text) && (this.errorRank || 0) < 2) {
      this.lastError = text.replace(/^ERROR:\s*/, "");
      this.errorRank = 2;
    } else if (level === "error" && !/^\s*(WARNING|ERROR: Ignored)/.test(text) && !this.lastError) {
      this.lastError = text;
      this.errorRank = 1;
    }
    if (/^(Install|Fix|Update|Run) /.test(text) || /winget install|brew install|apt install/.test(text)) {
      this.lastFix = text;
    }
  }

  onExit(code) {
    this.child = null;
    if (this.stopping) {
      this.update({ state: "idle", step: null, detail: "Left the mesh." });
      this.emit("stopped");
      return;
    }
    // 2 means GradMesh decided this machine cannot contribute as configured
    // (unsupported Python, blocked GPU, a kernel that will not run). Retrying
    // would only repeat it, so say why and wait for the person.
    const permanent = code === 2 || /token was rejected/i.test(this.lastError);
    if (permanent || this.status.step !== "contribute") {
      this.update({
        state: "error",
        error: "exited",
        detail: this.lastError || `The agent stopped (exit code ${code}).`,
        fix: this.lastFix || null,
      });
      return;
    }
    // It was contributing and fell over: come back on its own, with backoff.
    this.restarts += 1;
    const delay = Math.min(60, 5 * 2 ** Math.min(this.restarts - 1, 4));
    this.update({ state: "reconnecting", detail: `The agent stopped; restarting in ${delay}s.` });
    this.restartTimer = setTimeout(() => {
      if (!this.stopping && this.target) this.start(this.target, this.options);
    }, delay * 1000);
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) {
      this.update({ state: "idle", step: null, detail: "" });
      return;
    }
    this.update({ state: "stopping", detail: "Leaving the mesh" });
    const { nodeId } = this.status;
    await stopTree(child);
    // Then say goodbye on its behalf, so the host reassigns this machine's
    // shard now instead of waiting out three missed heartbeats. On Windows the
    // agent cannot catch a polite stop, so this is the only goodbye it gets;
    // elsewhere it already left and this is a harmless no-op. After the stop,
    // never before: a live worker told it is unknown simply registers again.
    if (nodeId && this.target) {
      try {
        await fetch(`${this.target.coordinator}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Mesh-Token": this.target.token },
          body: JSON.stringify({ node_id: nodeId }),
          signal: AbortSignal.timeout(2500),
        });
      } catch {
        // The host may already be gone.
      }
    }
  }
}

module.exports = { Agent, AGENT_FILES };
