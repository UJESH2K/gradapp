"use strict";

/**
 * Every path GradApp reads or writes, in one place.
 *
 * The rules follow GradMesh v5 (scripts/lib/paths.mjs): anything that is only
 * true for one machine (a Python environment, a setup record, a pid) lives in
 * per-user local app data, never in a folder OneDrive or iCloud would sync.
 *
 * The contributor environment is deliberately the same folder the one-line
 * join command uses (~/.gradmesh/agent), so a machine that already joined from
 * a terminal does not download PyTorch a second time.
 */

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

function machineHome() {
  if (process.env.GRADAPP_HOME) return path.resolve(process.env.GRADAPP_HOME);
  if (IS_WINDOWS) {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "GradApp");
  }
  if (IS_MAC) return path.join(os.homedir(), "Library", "Application Support", "GradApp");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "gradapp");
}

/** The bundled GradMesh engine: Python sources shipped next to the app, never inside the asar. */
function engineDir() {
  if (process.env.GRADAPP_ENGINE) return path.resolve(process.env.GRADAPP_ENGINE);
  return app.isPackaged
    ? path.join(process.resourcesPath, "engine")
    : path.join(__dirname, "..", "..", "engine");
}

function assetsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "assets") : path.join(__dirname, "..", "..", "assets");
}

const HOME = machineHome();

const PATHS = {
  home: HOME,
  settings: path.join(HOME, "settings.json"),
  logs: path.join(HOME, "logs"),
  // Contributor side. Shared with `irm .../join.ps1 | iex` and `curl .../join.sh | sh`.
  agentHome: process.env.GRADMESH_AGENT_HOME || path.join(os.homedir(), ".gradmesh", "agent"),
  // Host side.
  hostVenv: path.join(HOME, "host", "venv"),
  hostSetup: path.join(HOME, "host", "setup.json"),
  hostSetupLog: path.join(HOME, "host", "setup.log"),
  defaultMeshState: path.join(HOME, "mesh"),
};

function venvPython(venv) {
  return IS_WINDOWS ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { IS_WINDOWS, IS_MAC, PATHS, engineDir, assetsDir, venvPython, ensureDir };
