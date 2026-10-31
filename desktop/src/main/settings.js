"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PATHS, ensureDir } = require("./paths");

const DEFAULTS = {
  deviceName: os.hostname().replace(/\.local$/, ""),
  backend: "auto",
  closeToTray: true,
  startAtLogin: false,
  startHidden: false,
  // Rejoin the last mesh when the app starts. Off until someone has joined once.
  autoContribute: false,
  lastMesh: null, // { coordinator, web, token, meshName, meshId }
  autoHost: false,
  coordinatorPort: 8000,
  beaconPort: 3000,
  meshStateDir: PATHS.defaultMeshState,
  meshName: "GradMesh",
  notifications: true,
  theme: "system",
  checkUpdates: true,
  onboarded: false,
};

let cache = null;
const listeners = new Set();

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PATHS.settings, "utf8")) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save() {
  ensureDir(path.dirname(PATHS.settings));
  const temp = PATHS.settings + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(cache, null, 2));
  fs.renameSync(temp, PATHS.settings);
}

function get(key) {
  const all = load();
  return key ? all[key] : { ...all };
}

function set(patch) {
  load();
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in DEFAULTS) clean[key] = value;
  }
  cache = { ...cache, ...clean };
  save();
  for (const listener of listeners) listener(cache, clean);
  return { ...cache };
}

function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = { get, set, onChange, DEFAULTS };
