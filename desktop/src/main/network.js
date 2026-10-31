"use strict";

/**
 * Finding meshes on this network, and the addresses this machine is reachable at.
 *
 * A GradMesh coordinator answers GET /health on port 8000 without a token and
 * claims gradmesh.local over multicast DNS. So discovery is: ask the OS
 * resolver for gradmesh.local (it speaks mDNS on macOS, Windows 10+ and most
 * Linux desktops), and in parallel sweep this machine's own /24 for /health.
 * Each hit is then asked for its token on port 3000, where both GradMesh's
 * dashboard (/join.sh) and a GradApp host (/gradapp.json) publish it.
 */

const dns = require("node:dns/promises");
const { networkInterfaces } = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const VIRTUAL_ADAPTER =
  /vethernet|virtualbox|vbox|vmware|vmnet|hyper-v|wsl|docker|br-|veth|tailscale|zerotier|wireguard|utun|tun\d|tap\d|vpn|npcap|loopback|bluetooth/i;

function lanAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      found.push({ name, address: entry.address, netmask: entry.netmask, virtual: VIRTUAL_ADAPTER.test(name) });
    }
  }
  const range = (a) => (a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : a.startsWith("172.") ? 2 : 3);
  const wireless = (n) => (/wi-?fi|wlan|wireless|en0|eth|ethernet/i.test(n) ? 0 : 1);
  return found.sort(
    (a, b) => Number(a.virtual) - Number(b.virtual) || wireless(a.name) - wireless(b.name) || range(a.address) - range(b.address)
  );
}

function primaryLanAddress() {
  return lanAddresses()[0]?.address || "127.0.0.1";
}

async function getJson(url, timeoutMs = 1200, headers = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** The token and name a host publishes on its join port, or nulls. */
async function readInvite(hostname, webPort = 3000) {
  const web = `http://${hostname}:${webPort}`;
  try {
    const info = await getJson(`${web}/gradapp.json`, 2500);
    if (info?.token) return { web, token: info.token, meshName: info.meshName || null, kind: "gradapp" };
  } catch {
    // Not a GradApp host; try GradMesh's dashboard.
  }
  try {
    const response = await fetch(`${web}/join.sh`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const token = (await response.text()).match(/^MESH_TOKEN="([^"]+)"/m)?.[1];
      if (token) return { web, token, meshName: null, kind: "dashboard" };
    }
  } catch {
    // No join surface; the person types the token.
  }
  return { web, token: null, meshName: null, kind: null };
}

async function probeHost(hostname, port, timeoutMs) {
  try {
    const health = await getJson(`http://${hostname}:${port}/health`, timeoutMs);
    if (health?.status !== "ok" || !health.mesh_id) return null;
    return { hostname, port, health };
  } catch {
    return null;
  }
}

/** Every host address on the /24 around each real adapter. */
function sweepTargets() {
  const targets = new Set();
  for (const entry of lanAddresses()) {
    if (entry.virtual) continue;
    const [a, b, c] = entry.address.split(".");
    for (let d = 1; d < 255; d += 1) targets.add(`${a}.${b}.${c}.${d}`);
  }
  return [...targets];
}

/**
 * Meshes reachable from here, best first. Dedupes by mesh id, so one host seen
 * as gradmesh.local and as 192.168.1.20 is listed once (by IP, which is the
 * address every machine can use).
 */
async function discover({ port = 8000, webPort = 3000, onProgress } = {}) {
  const found = new Map();
  const own = new Set(["127.0.0.1", ...lanAddresses().map((entry) => entry.address)]);

  const record = async (hit) => {
    if (!hit) return;
    const id = hit.health.mesh_id;
    const existing = found.get(id);
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(hit.hostname);
    if (existing && (!isIp || existing.isIp)) return;
    const entry = {
      meshId: id,
      hostname: hit.hostname,
      isIp,
      local: own.has(hit.hostname),
      coordinator: `http://${hit.hostname}:${hit.port}`,
      version: hit.health.version,
      protocol: hit.health.protocol,
      nodesActive: hit.health.nodes_active,
      torchReady: hit.health.torch_ready,
    };
    found.set(id, entry);
    onProgress?.({ found: [...found.values()] });
  };

  const viaMdns = (async () => {
    try {
      const { address } = await dns.lookup("gradmesh.local", { family: 4 });
      await record(await probeHost(address, port, 1500));
    } catch {
      // No mDNS answer; the sweep still runs.
    }
  })();

  const targets = sweepTargets();
  let index = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(64, targets.length) }, async () => {
    while (index < targets.length) {
      const target = targets[index++];
      await record(await probeHost(target, port, 700));
      done += 1;
      if (done % 32 === 0) onProgress?.({ scanned: done, total: targets.length });
    }
  });
  await Promise.all([viaMdns, ...workers]);

  const meshes = [...found.values()];
  await Promise.all(
    meshes.map(async (mesh) => {
      Object.assign(mesh, await readInvite(mesh.hostname, webPort));
    })
  );
  return meshes.sort((a, b) => Number(b.local) - Number(a.local) || (b.nodesActive || 0) - (a.nodesActive || 0));
}

/**
 * Turn whatever a person typed into a target: "192.168.1.20", "gradmesh.local",
 * "http://192.168.1.20:3000" (the dashboard address GradMesh prints) or
 * "http://192.168.1.20:8000" (the coordinator), or a gradapp:// invite link.
 */
function parseAddress(value, { port = 8000, webPort = 3000 } = {}) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^gradapp:/i.test(text)) {
    const url = new URL(text.replace(/^gradapp:\/*/i, "gradapp://"));
    const server = url.searchParams.get("server");
    const token = url.searchParams.get("token");
    if (!server) return null;
    const parsed = parseAddress(server, { port, webPort });
    return parsed ? { ...parsed, token: token || null, meshName: url.searchParams.get("name") } : null;
  }
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return null;
  }
  const given = Number(url.port) || null;
  const coordinatorPort = given && given !== webPort ? given : port;
  return {
    hostname: url.hostname,
    coordinator: `http://${url.hostname}:${coordinatorPort}`,
    web: `http://${url.hostname}:${webPort}`,
  };
}

/** Download a file, following redirects, to `target` atomically. */
async function download(url, target, { onProgress, timeoutMs = 10 * 60 * 1000 } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  const temp = target + ".part";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    onProgress?.(received, total);
  });
  await pipeline(body, fs.createWriteStream(temp));
  fs.renameSync(temp, target);
  return { bytes: received };
}

module.exports = { lanAddresses, primaryLanAddress, discover, readInvite, parseAddress, download, getJson };
