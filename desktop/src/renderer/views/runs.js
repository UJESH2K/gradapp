import { h, clear, button, busy, field, select, emptyState, pill, fmtDuration, fmtNumber, fmtAgo, toast } from "../ui.js";
import { store, subscribe, refreshMesh } from "../store.js";
import { noMesh } from "./mesh.js";
import { go } from "../router.js";

const STATUS_TONE = { running: "busy", planning: "info", waiting: "warn", completed: "live", stopped: "neutral", failed: "danger" };

export function renderRuns(root) {
  let runs = null;
  let datasets = [];
  let models = [];
  let timer = null;

  const list = h("div", { class: "runs" });
  const form = h("form", { class: "run-form panel" });
  const nameInput = h("input", { class: "input", value: "mesh-run", maxlength: 80 });
  const roundsInput = h("input", { class: "input", type: "number", min: 1, max: 200, value: 4 });
  const imgszInput = h("input", { class: "input", type: "number", min: 32, max: 2048, step: 32, value: 640 });
  const batchInput = h("input", { class: "input", type: "number", min: 1, max: 128, value: 8 });
  let datasetId = null;
  let model = "yolov8n.pt";

  async function load() {
    const [r, d, m] = await Promise.all([
      window.gradapp.api("GET", "/runs"),
      window.gradapp.api("GET", "/datasets"),
      window.gradapp.api("GET", "/models"),
    ]);
    runs = r.ok ? r.data.runs : runs || [];
    datasets = d.ok ? d.data.datasets.filter((item) => item.available !== false) : datasets;
    models = m.ok ? m.data.models.map((item) => item.name) : models;
    if (!datasetId) datasetId = datasets.find((item) => item.is_default)?.id || datasets[0]?.id || null;
    if (models.length && !models.includes(model)) model = models[0];
    draw();
  }

  function trainingNotice() {
    const host = store.app?.host;
    if (host?.state === "live" && host.trainingPlane === "failed") {
      return h(
        "div",
        { class: "callout callout-danger" },
        h("p", {}, "Installing PyTorch on this computer failed, so runs cannot start. Activity has pip's reason; usually it is the internet connection or disk space."),
        h("div", { class: "row" }, button("Retry the install", { kind: "secondary", small: true, iconName: "refresh", onClick: (e) => busy(e.currentTarget, () => window.gradapp.repairHost()) }), button("Open Activity", { kind: "ghost", small: true, onClick: () => go("activity") }))
      );
    }
    return h("p", { class: "callout callout-warn" }, host?.state === "live" ? "Installing PyTorch on this computer. Runs can start once it finishes; the first time takes a few minutes." : "The host is still installing PyTorch. Runs can start once it finishes.");
  }

  function drawForm() {
    const torchReady = store.mesh?.torch_ready;
    const submit = button("Start run", { kind: "primary", iconName: "play", type: "submit" });
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(submit, async () => {
        const result = await window.gradapp.api("POST", "/runs", {
          name: nameInput.value.trim() || "mesh-run",
          dataset_id: datasetId,
          base_model: model,
          rounds: Number(roundsInput.value) || 4,
          imgsz: Number(imgszInput.value) || 640,
          batch_size: Number(batchInput.value) || 8,
        });
        if (result.ok) {
          toast(`${nameInput.value.trim() || "Run"} started`);
          load();
          refreshMesh();
        }
        return result;
      });
    };
    clear(
      form,
      h("div", { class: "panel-head" }, h("h2", {}, "New training run")),
      !datasets.length
        ? h("p", { class: "callout" }, "Add a dataset first. ", h("a", { href: "#", onclick: (e) => (e.preventDefault(), go("datasets")) }, "Open Datasets"))
        : null,
      torchReady === false ? trainingNotice() : null,
      h(
        "div",
        { class: "form-grid" },
        field("Name", nameInput),
        field("Dataset", select(datasets.length ? datasets.map((item) => [item.id, `${item.name}${item.train_count ? ` (${item.train_count} images)` : ""}`]) : [["", "No datasets"]], datasetId, (value) => (datasetId = value))),
        field("Base model", select(models.length ? models : ["yolov8n.pt", "yolo11n.pt"], model, (value) => (model = value))),
        field("Rounds", roundsInput, "One epoch per round, averaged across machines."),
        field("Image size", imgszInput),
        field("Batch size", batchInput)
      ),
      h("div", { class: "row" }, submit)
    );
    submit.disabled = !datasets.length;
  }

  function runCard(run) {
    const live = ["running", "planning", "waiting"].includes(run.status);
    const progress = run.rounds ? Math.min(1, (run.current_round || 0) / run.rounds) : 0;
    return h(
      "article",
      { class: `run${live ? " is-live" : ""}` },
      h(
        "div",
        { class: "run-head" },
        h("div", {}, h("h3", {}, run.name), h("p", { class: "dim" }, `${run.dataset_name || "dataset"} · ${run.base_model} · started ${fmtAgo(run.started_at || run.created_at)}`)),
        pill(run.status, STATUS_TONE[run.status] || "neutral")
      ),
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": run.rounds, "aria-valuenow": run.current_round || 0 }, h("span", { style: { width: `${(progress * 100).toFixed(1)}%` } })),
      h(
        "dl",
        { class: "run-stats" },
        h("div", {}, h("dt", {}, "Round"), h("dd", {}, `${run.current_round || 0} / ${run.rounds}`)),
        h("div", {}, h("dt", {}, "Machines"), h("dd", {}, `${live ? run.live_workers ?? 0 : run.peak_workers ?? 0}`)),
        h("div", {}, h("dt", {}, "Speed-up"), h("dd", {}, run.speedup ? `${fmtNumber(run.speedup, 2)}×` : "–")),
        h("div", {}, h("dt", {}, "mAP50"), h("dd", {}, run.map50 != null ? fmtNumber(run.map50, 3) : "–")),
        h("div", {}, h("dt", {}, "Wall clock"), h("dd", {}, fmtDuration(run.wall_clock_seconds)))
      ),
      run.error ? h("p", { class: "callout callout-danger" }, run.error) : null,
      h(
        "div",
        { class: "row" },
        live
          ? button("Stop", {
              kind: "secondary",
              small: true,
              iconName: "stop",
              onClick: (e) => busy(e.currentTarget, async () => {
                const result = await window.gradapp.api("POST", `/runs/${run.id}/stop`);
                load();
                return result;
              }),
            })
          : null,
        run.has_artifact
          ? button("Save weights", { kind: "secondary", small: true, iconName: "download", onClick: (e) => busy(e.currentTarget, () => window.gradapp.saveArtifact(run.id, run.name)) })
          : null,
        !live
          ? button("Delete", {
              kind: "ghost",
              small: true,
              iconName: "trash",
              onClick: (e) => busy(e.currentTarget, async () => {
                const result = await window.gradapp.api("DELETE", `/runs/${run.id}`);
                load();
                return result;
              }),
            })
          : null
      )
    );
  }

  function draw() {
    if (!store.app?.target) return noMesh(root);
    if (!root.contains(list)) {
      clear(root, h("header", { class: "page-head" }, h("h1", {}, "Training runs"), h("p", { class: "lede" }, "Each round, every machine trains on a shard sized to finish together, and the host averages the weights.")), form, list);
    }
    drawForm();
    if (runs === null) {
      clear(list, h("div", { class: "skeleton-block" }));
      return;
    }
    clear(list, runs.length ? [h("h2", { class: "section-title" }, "Runs"), runs.map(runCard)] : emptyState("No runs yet", "Start one above. It uses every machine that is online and admitted."));
  }

  draw();
  if (store.app?.target) load();
  const tick = () => {
    timer = setTimeout(async () => {
      if (document.visibilityState === "visible" && store.app?.target) {
        const hasLive = (runs || []).some((run) => ["running", "planning", "waiting"].includes(run.status));
        if (hasLive || Math.random() < 0.25) await load();
      }
      tick();
    }, 4000);
  };
  tick();
  let hadTarget = Boolean(store.app?.target);
  let lastReady = Boolean(store.mesh?.torch_ready);
  let lastPlane = store.app?.host?.trainingPlane;
  const off = subscribe((reason) => {
    if (reason === "mesh" && root.contains(form)) {
      const ready = Boolean(store.mesh?.torch_ready);
      if (ready !== lastReady) {
        lastReady = ready;
        drawForm();
      }
    }
    if (reason !== "state") return;
    const plane = store.app?.host?.trainingPlane;
    if (plane !== lastPlane) {
      lastPlane = plane;
      if (root.contains(form)) drawForm();
    }
    const hasTarget = Boolean(store.app?.target);
    if (hasTarget !== hadTarget) {
      hadTarget = hasTarget;
      root.replaceChildren();
      draw();
      if (hasTarget) load();
    }
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
