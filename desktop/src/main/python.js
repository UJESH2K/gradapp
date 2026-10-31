"use strict";

/**
 * Find a Python that PyTorch 2.13 supports (3.10 to 3.13).
 *
 * Same rules as GradMesh's join scripts, with one difference that matters for a
 * desktop app: a program opened from the Dock, Start menu or a launcher does not
 * inherit the PATH a terminal has (Homebrew's /opt/homebrew/bin is the classic
 * case), so well-known install locations are tried by absolute path too.
 *
 * On an Apple Silicon Mac the interpreter must be arm64; an Intel Python runs
 * under Rosetta where PyTorch has no Metal build. Every candidate is run through
 * `arch -arm64` so an Intel-only interpreter fails the check instead of winning.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { IS_WINDOWS, IS_MAC } = require("./paths");
const { run } = require("./proc");

const MIN = 310;
const MAX = 313;
const PROBE = "import sys, platform; print(sys.version_info.major * 100 + sys.version_info.minor, platform.python_version(), platform.machine(), sys.executable)";

let cached = null;

function windowsCandidates() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  const list = [];
  for (const minor of [12, 11, 13, 10]) {
    list.push({ command: "py", args: [`-3.${minor}`] });
    list.push({ command: path.join(local, "Programs", "Python", `Python3${minor}`, "python.exe"), args: [] });
    for (const root of programs) list.push({ command: path.join(root, `Python3${minor}`, "python.exe"), args: [] });
  }
  list.push({ command: "python", args: [] }, { command: "python3", args: [] });
  return list;
}

function macCandidates() {
  const list = [];
  for (const minor of [12, 11, 13, 10]) {
    list.push(`/opt/homebrew/bin/python3.${minor}`);
    list.push(`/Library/Frameworks/Python.framework/Versions/3.${minor}/bin/python3`);
    list.push(`/usr/local/bin/python3.${minor}`);
    list.push(path.join(os.homedir(), ".pyenv", "shims", `python3.${minor}`));
  }
  list.push("/opt/homebrew/bin/python3", "/usr/local/bin/python3");
  return list.map((command) => ({ command, args: [] }));
}

function linuxCandidates() {
  const list = [];
  for (const minor of [12, 11, 13, 10]) {
    list.push(`python3.${minor}`, `/usr/bin/python3.${minor}`, `/usr/local/bin/python3.${minor}`);
    list.push(path.join(os.homedir(), ".pyenv", "shims", `python3.${minor}`));
  }
  list.push("python3", "/usr/bin/python3", "python");
  return list.map((command) => ({ command, args: [] }));
}

function candidates() {
  if (IS_WINDOWS) return windowsCandidates();
  if (IS_MAC) return macCandidates();
  return linuxCandidates();
}

function looksMissing(command) {
  return path.isAbsolute(command) && !fs.existsSync(command);
}

async function appleSilicon() {
  if (!IS_MAC) return false;
  if (process.arch === "arm64") return true;
  const result = await run("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], { timeoutMs: 3000 });
  return result.stdout.trim() === "1";
}

/**
 * The interpreter to run, as `{ command, args }` ready for spawn, plus what it
 * reported about itself. `null` when nothing suitable is installed.
 */
async function findPython({ refresh = false } = {}) {
  if (cached && !refresh) return cached;
  const arm = await appleSilicon();
  const seen = new Set();

  for (const candidate of candidates()) {
    if (looksMissing(candidate.command)) continue;
    const key = candidate.command + " " + candidate.args.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);

    // macOS's /usr/bin/python3 is 3.9, or a stub that opens an installer dialog.
    if (IS_MAC && candidate.command === "/usr/bin/python3") continue;

    const command = arm ? "/usr/bin/arch" : candidate.command;
    const args = arm ? ["-arm64", candidate.command, ...candidate.args] : [...candidate.args];
    const probe = await run(command, [...args, "-c", PROBE], { timeoutMs: 8000 });
    if (probe.code !== 0) continue;
    const [number, version, machine, executable] = probe.stdout.trim().split(/\s+/);
    const value = Number(number);
    if (!(value >= MIN && value <= MAX)) continue;

    cached = { command, args, version, machine, executable: executable || candidate.command };
    return cached;
  }
  cached = null;
  return null;
}

/** What to tell someone who has no usable Python, per platform. */
function installHint() {
  if (IS_WINDOWS) {
    return {
      text: "GradApp needs Python 3.10 to 3.13. Install Python 3.12 (one click, no admin rights), then press Retry.",
      command: "winget install --id Python.Python.3.12 -e --scope user",
      url: "https://www.python.org/downloads/windows/",
      canAutoInstall: true,
    };
  }
  if (IS_MAC) {
    return {
      text: "GradApp needs an Apple Silicon Python 3.10 to 3.13. Install it with Homebrew, or the python.org installer, then press Retry.",
      command: "brew install python@3.12",
      url: "https://www.python.org/downloads/macos/",
      canAutoInstall: false,
    };
  }
  return {
    text: "GradApp needs Python 3.10 to 3.13 with venv support. Install it with your package manager, then press Retry.",
    command: "sudo apt install python3.12 python3.12-venv   # or: sudo dnf install python3.12",
    url: "https://www.python.org/downloads/source/",
    canAutoInstall: false,
  };
}

/** Windows only: install Python 3.12 for this user with winget, silently. */
async function autoInstallPython(onLine) {
  if (!IS_WINDOWS) return { ok: false, error: "Automatic install is only available on Windows." };
  onLine?.("installing Python 3.12 with winget (user scope, no admin rights)");
  const result = await run(
    "winget",
    [
      "install",
      "--id",
      "Python.Python.3.12",
      "-e",
      "--scope",
      "user",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ],
    { timeoutMs: 10 * 60 * 1000 }
  );
  for (const line of (result.stdout + result.stderr).split(/\r?\n/)) if (line.trim()) onLine?.(line.trim());
  const found = await findPython({ refresh: true });
  return found ? { ok: true, python: found } : { ok: false, error: result.error || "winget finished but Python 3.12 was not found." };
}

module.exports = { findPython, installHint, autoInstallPython };
