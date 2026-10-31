#!/usr/bin/env node
/**
 * Fast checks that need no display: syntax of every source file, the engine is
 * complete, the agent file list matches what GradMesh serves, icons exist, and
 * the main-process helpers behave. Runs in CI before packaging.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let failures = 0;
const ok = (message) => console.log(`  ok  ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL ${message}`);
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}

console.log("syntax");
for (const file of walk(path.join(root, "src")).filter((f) => f.endsWith(".js"))) {
  const isModule = file.includes(`${path.sep}renderer${path.sep}`);
  try {
    if (isModule) execFileSync(process.execPath, ["--input-type=module", "--check"], { input: readFileSync(file) });
    else execFileSync(process.execPath, ["--check", file]);
  } catch (error) {
    fail(`${path.relative(root, file)}\n${error.stderr || error.message}`);
  }
}
ok("all JavaScript parses");

console.log("engine");
const engine = path.join(root, "engine");
const agentSource = readFileSync(path.join(root, "src", "main", "agent.js"), "utf8");
const files = JSON.parse(
  "[" + /const AGENT_FILES = \[([\s\S]*?)\];/.exec(agentSource)[1].replace(/,\s*$/, "").replace(/'/g, '"') + "]"
);
for (const file of files) {
  if (!existsSync(path.join(engine, file))) fail(`engine/${file} is missing`);
}
for (const file of ["coordinator/app.py", "coordinator/store.py", "coordinator/scheduler.py"]) {
  if (!existsSync(path.join(engine, file))) fail(`engine/${file} is missing`);
}
ok(`${files.length} agent files and the coordinator are bundled`);

const python = ["python3", "python"].find((cmd) => {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});
if (python) {
  try {
    const out = execFileSync(python, [path.join(engine, "setup_env.py"), "detect", "--json"], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    const parsed = JSON.parse(out);
    if (!parsed.profile?.backend) throw new Error("no profile");
    ok(`setup_env.py detect works (${parsed.profile.backend})`);
  } catch (error) {
    fail(`setup_env.py detect: ${error.message}`);
  }
} else {
  console.log("  --  no Python here, skipped engine run");
}

console.log("assets");
for (const file of ["icon.png", "logo.png", "tray.png", "tray-active.png", "trayTemplate.png", "trayActiveTemplate.png"]) {
  if (!existsSync(path.join(root, "assets", file))) fail(`assets/${file} is missing`);
}
ok("icons present");

console.log("helpers");
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: { isPackaged: false, getVersion: () => "0.0.0" } };
  return realLoad.call(this, request, ...rest);
};
const network = require(path.join(root, "src", "main", "network.js"));
const cases = [
  ["192.168.1.20", "http://192.168.1.20:8000"],
  ["http://192.168.1.20:3000", "http://192.168.1.20:8000"],
  ["http://10.0.0.5:8100", "http://10.0.0.5:8100"],
  ["gradmesh.local", "http://gradmesh.local:8000"],
];
for (const [input, expected] of cases) {
  const got = network.parseAddress(input)?.coordinator;
  if (got !== expected) fail(`parseAddress(${input}) = ${got}, expected ${expected}`);
}
const invite = network.parseAddress("gradapp://join?server=http%3A%2F%2F192.168.1.9%3A8000&token=abc&name=Lab");
if (invite?.coordinator !== "http://192.168.1.9:8000" || invite?.token !== "abc") fail(`invite link parsed as ${JSON.stringify(invite)}`);
const { newer } = require(path.join(root, "src", "main", "updates.js"));
if (!newer("v1.2.0", "1.1.9") || newer("1.0.0", "1.0.0") || newer("0.9.9", "1.0.0")) fail("version comparison");
ok("address parsing, invite links, version comparison");

if (failures) {
  console.log(`\n${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("\nall checks passed");
