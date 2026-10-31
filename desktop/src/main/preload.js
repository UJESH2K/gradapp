"use strict";

/** The whole surface the page can use. Nothing else from Node or Electron is exposed. */

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const EVENTS = new Set(["state", "log", "mesh:event", "discover:progress", "invite", "navigate", "update"]);

contextBridge.exposeInMainWorld("gradapp", {
  platform: process.platform,
  state: invoke("state:get"),
  logs: invoke("logs:get"),
  openLogs: invoke("logs:open"),
  takeInvite: invoke("invite:take"),
  hardware: invoke("hardware:get"),
  installPython: invoke("python:install"),
  setSettings: invoke("settings:set"),
  discover: invoke("mesh:discover"),
  resolve: invoke("mesh:resolve"),
  join: invoke("agent:start"),
  leave: invoke("agent:stop"),
  contributeLocal: invoke("agent:contributeLocal"),
  host: invoke("host:start"),
  stopHost: invoke("host:stop"),
  repairHost: invoke("host:repair"),
  rotateToken: invoke("host:rotate"),
  invite: invoke("host:reveal"),
  api: invoke("api"),
  uploadDataset: invoke("datasets:upload"),
  saveArtifact: invoke("runs:artifact"),
  openExternal: invoke("open:external"),
  openFolder: invoke("open:folder"),
  pickFolder: invoke("pick:folder"),
  checkUpdate: invoke("update:check"),
  quit: invoke("app:quit"),
  hide: invoke("window:hide"),
  on(channel, listener) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
