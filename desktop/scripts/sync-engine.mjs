#!/usr/bin/env node
/**
 * Refresh the bundled GradMesh engine from a Gradmesh checkout.
 *
 *   npm run sync-engine -- "C:\Users\you\Documents\GitHub\Gradmesh-v5"
 *
 * Copies engine/*.py, the requirements files and engine/coordinator into
 * desktop/engine, skipping caches and tests. Run it whenever GradMesh changes,
 * then rebuild: the app ships exactly what is in desktop/engine.
 */

import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "..", "engine");
const source = process.argv[2] ? path.resolve(process.argv[2], "engine") : null;

if (!source || !existsSync(path.join(source, "worker.py"))) {
  console.error("Usage: npm run sync-engine -- <path to the Gradmesh repository>");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
const skip = (name) => name === "__pycache__" || name === "tests" || name.endsWith(".pyc");
const copyTree = (from, to) => {
  for (const name of readdirSync(from)) {
    if (skip(name)) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (statSync(src).isDirectory()) copyTree(src, dst);
    else if (/\.(py|txt)$/.test(name)) cpSync(src, dst);
  }
};
copyTree(source, target);

const version = /__version__ = "([^"]+)"/.exec(
  (await import("node:fs")).readFileSync(path.join(target, "version.py"), "utf8")
)?.[1];
console.log(`engine synced from ${source} (GradMesh ${version || "unknown version"})`);
