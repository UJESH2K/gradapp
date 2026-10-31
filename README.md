<p align="center"><img src="desktop/assets/logo.png" alt="GradApp" width="112" /></p>

# GradApp

**GradMesh as a desktop app.** Download it, open it, press **Join** or **Host a mesh**. No terminal, no Node, no cloning a repo.

```
gradapp/
├── website/        Download page: detects Windows / macOS / Linux, one-click installer
├── desktop/        The Electron app (Windows .exe, macOS .dmg, Linux .AppImage/.deb/.rpm)
│   ├── src/main/       Main process: Python finder, agent, host, discovery, tray
│   ├── src/renderer/   The window: plain HTML/CSS/JS, no framework, no build step
│   ├── engine/         The GradMesh v5 Python engine, bundled with the app
│   ├── assets/         Icons (app, tray)
│   └── scripts/        check, sync-engine, icons
└── .github/workflows/release.yml   Builds all three OSes on a tag, publishes the website
```

## How it fits GradMesh

GradMesh v5 is three layers: a Next.js dashboard, a FastAPI **coordinator**, and Python **workers**. Getting onto a mesh used to mean `npm run dev` on the host and pasting `irm …/join.ps1 | iex` on every other machine. GradApp keeps the engine exactly as it is and replaces only the parts a person has to touch:

| Before (terminal) | GradApp |
|---|---|
| `npm install && npm run dev` on the host | **Host a mesh**: builds the control-plane venv with `setup_env.py install`, starts `uvicorn coordinator.app:app`, downloads the YOLO checkpoints, installs PyTorch in the background |
| Read the IP off the host's screen | **Contribute** scans the network: `gradmesh.local` over mDNS plus a /24 sweep of `GET /health` on port 8000 |
| Paste `irm http://host:3000/join.ps1 \| iex` | **Join**: copies the agent to `~/.gradmesh/agent`, runs `setup_env.py agent` (same installer, same venv the one-liner uses) and shows its progress as a stepper |
| Ctrl+C to leave | **Stop contributing**, or quit from the tray |
| Dashboard in a browser | Native screens for machines, runs, datasets, invites and activity, talking to the coordinator API with the token held in the main process |

A GradApp host still serves `/join.ps1`, `/join.sh`, `/api/agent/*` on port 3000, so machines without the app can join with the old one-liner, and `npm run worker -- --server host` still works. GradApp can also join a mesh started with `npm run dev`, and attaches to a coordinator already running on the same computer instead of fighting over the port.

### Discreet by design

- Closing the window leaves GradApp in the tray, contributing. The tray menu has start/stop for both roles.
- Optional: open at login, start hidden, rejoin the last mesh automatically.
- No console windows on Windows (every child process is started hidden).
- Mesh polling pauses whenever the window is hidden; a hidden GradApp costs only the worker itself.
- Notifications are silent, rare (joined, or needs attention) and never shown while the window is in front.
- Esc on an idle window tucks it into the tray. `Ctrl/⌘ K` reaches every screen and action.

## Run it from source

You need Node 20+ and Python 3.10–3.13.

```bash
cd desktop
npm install
npm start          # or: npm run dev   (opens DevTools)
npm run check      # syntax, engine completeness, helper tests
```

The website is static: open `website/index.html`, or serve the folder with anything (`npx serve website`).

## Build installers

On each OS you can build its own installer locally:

```bash
cd desktop
npm run dist:win     # dist/GradApp-windows-x64.exe  and  -portable.exe
npm run dist:mac     # dist/GradApp-mac-universal.dmg and .zip
npm run dist:linux   # dist/GradApp-linux-x86_64.AppImage, -amd64.deb, -x86_64.rpm
```

**Release all three at once** (recommended): push the repo to `github.com/UJESH2K/gradapp`, then

```bash
git tag v1.0.0 && git push origin v1.0.0
```

GitHub Actions builds Windows, macOS and Linux in parallel and attaches every file to a release. The download buttons on the website point at `releases/latest/download/<fixed file name>`, so they always serve the newest build.

### Deploy the website on Vercel

1. vercel.com → **Add New… → Project** → import `UJESH2K/gradapp`.
2. **Root Directory**: `website`. **Framework Preset**: Other. Leave Build Command and Output Directory empty.
3. **Deploy.** Every push to `main` redeploys it; pull requests get preview URLs.

If the repository lives somewhere else, change `REPO` at the top of `website/app.js`, `publish.owner/repo` in `desktop/electron-builder.yml`, and `REPO` in `desktop/src/main/updates.js`.

### Code signing

Builds are unsigned, so Windows SmartScreen and macOS Gatekeeper warn on first launch (the website explains the click-through). To sign, add `CSC_LINK` / `CSC_KEY_PASSWORD` (Windows and macOS certificates) and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` as repository secrets and remove `identity: null` from the mac section of `electron-builder.yml`.

## Updating the engine

The app ships the Python in `desktop/engine`. When GradMesh changes:

```bash
cd desktop
npm run sync-engine -- "C:\Users\aadit\OneDrive\Documents\GitHub\Gradmesh-v5"
```

Contributors joining a GradApp host download the agent from that host, so a mesh always runs one agent version even if people have different GradApp builds.

## Where things live

| | Windows | macOS | Linux |
|---|---|---|---|
| App data, host venv, mesh state, logs | `%LOCALAPPDATA%\GradApp` | `~/Library/Application Support/GradApp` | `~/.local/share/gradapp` |
| Contributor PyTorch (shared with the one-line join) | `~/.gradmesh/agent` | same | same |

Uninstall the app and delete those two folders to remove everything.

## Trust model

Same as GradMesh: a mesh is protected by a token that anyone who can reach the host's port 3000 can read, and a worker runs code the host sends it. Host and join only on networks you control. Rotating the token (Invite → Rotate token) disconnects every machine.
