"use strict";

/**
 * Child processes, run quietly.
 *
 * Every Python process GradApp starts goes through here, so all of them get the
 * same treatment: no console window flashing up on Windows, unbuffered output
 * read line by line, ANSI colours stripped, and a stop that takes the whole
 * process tree with it (setup_env.py starts worker.py as its own child).
 */

const { spawn, execFile } = require("node:child_process");

const { IS_WINDOWS } = require("./paths");

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;

function stripAnsi(text) {
  return String(text).replace(ANSI, "");
}

/** Run to completion and collect output. Never throws; check `code`. */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const { timeoutMs = 20000, env, cwd } = options;
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...env }, cwd, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          error: error && typeof error.code !== "number" ? String(error.message || error) : null,
        });
      }
    );
  });
}

/**
 * Start a long-running process. `onLine(line, stream)` gets every output line.
 * Returns the ChildProcess; `stopTree(child)` ends it.
 */
function start(command, args, { cwd, env, onLine, onExit } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", ...env },
    windowsHide: true,
    // Its own process group on POSIX, so a stop reaches worker.py too.
    detached: !IS_WINDOWS,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pump = (stream, name) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      // Progress bars rewrite one line with \r; treat each rewrite as a line.
      const parts = buffer.split(/\r?\n|\r/);
      buffer = parts.pop();
      for (const part of parts) {
        const line = stripAnsi(part).trimEnd();
        if (line) onLine?.(line, name);
      }
    });
    stream.on("end", () => {
      const line = stripAnsi(buffer).trim();
      if (line) onLine?.(line, name);
    });
  };
  pump(child.stdout, "stdout");
  pump(child.stderr, "stderr");

  child.on("error", (error) => {
    onLine?.(`could not start ${command}: ${error.message}`, "stderr");
    onExit?.(-1, null);
  });
  child.on("exit", (code, signal) => onExit?.(code, signal));
  return child;
}

/**
 * Stop a process and everything it started. Polite first (so the worker can
 * tell the coordinator it is leaving), forceful after `graceMs`.
 */
function stopTree(child, graceMs = 6000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", finish);

    const force = () => {
      try {
        if (IS_WINDOWS) {
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        // already gone
      }
      setTimeout(finish, 800);
    };
    const timer = setTimeout(force, graceMs);

    // Windows has no polite signal for a hidden console process (taskkill
    // without /F only reaches windows), so it is ended at once; callers send
    // the coordinator a goodbye on its behalf. Elsewhere SIGINT lets the
    // worker leave the mesh itself.
    if (IS_WINDOWS) {
      clearTimeout(timer);
      force();
      return;
    }
    try {
      process.kill(-child.pid, "SIGINT");
    } catch {
      force();
    }
  });
}

module.exports = { run, start, stopTree, stripAnsi };
