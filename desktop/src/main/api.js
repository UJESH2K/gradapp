"use strict";

/**
 * The renderer's only road to a coordinator.
 *
 * The page never holds the mesh token, matching GradMesh's dashboard rule: it
 * asks the main process, which attaches the token server-side. Paths are
 * allowlisted so the bridge cannot be turned into a general HTTP client.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const ALLOWED = [
  /^\/health$/,
  /^\/mesh$/,
  /^\/runs(\/[\w-]+(\/stop)?)?$/,
  /^\/datasets(\/standard)?$/,
  /^\/datasets\/[\w-]+(\/default)?$/,
  /^\/models$/,
  /^\/policy$/,
  /^\/nodes\/[\w-]+(\/reset)?$/,
  /^\/token\/rotate$/,
];
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

function detailOf(body, status) {
  if (!body) return `HTTP ${status}`;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((item) => item.msg || JSON.stringify(item)).join("; ");
  return `HTTP ${status}`;
}

async function call(target, method, route, body, timeoutMs = 20000) {
  if (!target) return { ok: false, status: 0, error: "Not connected to a mesh." };
  const verb = String(method || "GET").toUpperCase();
  const pathOnly = String(route || "").split("?")[0];
  if (!METHODS.has(verb) || !ALLOWED.some((rule) => rule.test(pathOnly))) {
    return { ok: false, status: 0, error: `Blocked: ${verb} ${pathOnly}` };
  }
  try {
    const response = await fetch(`${target.coordinator}${route}`, {
      method: verb,
      headers: {
        "X-Mesh-Token": target.token || "",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) return { ok: false, status: response.status, error: detailOf(data, response.status) };
    return { ok: true, status: response.status, data };
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "timed out" : error.cause?.code || error.message;
    return { ok: false, status: 0, error: `Could not reach the mesh (${reason}).` };
  }
}

async function uploadDataset(target, file, name, makeDefault) {
  const form = new FormData();
  const blob = await fs.openAsBlob(file, { type: "application/zip" });
  form.append("file", blob, path.basename(file));
  form.append("name", name || path.basename(file, path.extname(file)));
  form.append("make_default", makeDefault ? "true" : "false");
  try {
    const response = await fetch(`${target.coordinator}/datasets`, {
      method: "POST",
      headers: { "X-Mesh-Token": target.token },
      body: form,
      signal: AbortSignal.timeout(60 * 60 * 1000),
    });
    const data = await response.json().catch(() => null);
    return response.ok ? { ok: true, data } : { ok: false, error: detailOf(data, response.status) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function saveArtifact(target, runId, destination) {
  const response = await fetch(`${target.coordinator}/runs/${encodeURIComponent(runId)}/artifact`, {
    headers: { "X-Mesh-Token": target.token },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    return { ok: false, error: detailOf(data, response.status) };
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  return { ok: true, path: destination };
}

/**
 * Follow the coordinator's server-sent event stream and hand each event to
 * `onEvent`. Reconnects with backoff; returns a stop function.
 */
function followEvents(getTarget, onEvent) {
  let stopped = false;
  let controller = null;
  let delay = 1000;

  const loop = async () => {
    while (!stopped) {
      const target = getTarget();
      if (!target) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      controller = new AbortController();
      try {
        const response = await fetch(`${target.coordinator}/events?replay=30`, {
          headers: { "X-Mesh-Token": target.token, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        delay = 1000;
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const data = block
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            try {
              onEvent(JSON.parse(data));
            } catch {
              // keep-alive or partial; ignore
            }
          }
          if (stopped) break;
        }
      } catch {
        // dropped; retry below
      }
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(15000, delay * 2);
    }
  };
  loop();
  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
    restart() {
      controller?.abort();
    },
  };
}

module.exports = { call, uploadDataset, saveArtifact, followEvents };
