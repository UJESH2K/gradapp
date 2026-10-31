import { h, clear, button, busy, emptyState, pill, fmtAgo, toast } from "../ui.js";
import { store, subscribe } from "../store.js";
import { noMesh } from "./mesh.js";

export function renderDatasets(root) {
  let datasets = null;
  let catalogue = [];
  let importing = null;
  let timer = null;

  const mine = h("div", { class: "datasets" });
  const standard = h("div", { class: "catalogue" });

  async function load() {
    const [d, s] = await Promise.all([window.gradapp.api("GET", "/datasets"), window.gradapp.api("GET", "/datasets/standard")]);
    datasets = d.ok ? d.data.datasets : datasets || [];
    if (s.ok) {
      catalogue = s.data.catalogue || [];
      importing = s.data.import?.running ? s.data.import : null;
      if (s.data.import?.error && !importing) importing = { error: s.data.import.error };
    }
    draw();
  }

  function draw() {
    if (!store.app?.target) return noMesh(root);
    if (!root.contains(mine)) {
      const upload = button("Upload a dataset", { kind: "primary", iconName: "upload" });
      upload.addEventListener("click", () =>
        busy(upload, async () => {
          const result = await window.gradapp.uploadDataset(!(datasets || []).length);
          if (result.ok) {
            toast(`${result.data?.name || "Dataset"} added`);
            load();
          }
          return result;
        })
      );
      clear(
        root,
        h("header", { class: "page-head" }, h("h1", {}, "Datasets"), h("p", { class: "lede" }, "A YOLO dataset as a .zip: images and labels folders plus a data.yaml. It stays on the host; machines fetch only the images in their shard."), h("div", { class: "row" }, upload)),
        mine,
        h("h2", { class: "section-title" }, "Standard datasets"),
        h("p", { class: "dim section-sub" }, "Downloaded by the host from Ultralytics. Useful to check the pipeline before training on your own data."),
        standard
      );
    }
    if (datasets === null) {
      clear(mine, h("div", { class: "skeleton-block" }));
    } else if (!datasets.length) {
      clear(mine, emptyState("No datasets yet", "Upload a .zip, or import COCO128 below to try a run in a few minutes."));
    } else {
      clear(
        mine,
        datasets.map((item) =>
          h(
            "div",
            { class: "dataset" },
            h(
              "div",
              { class: "dataset-main" },
              h("strong", {}, item.name),
              h("span", { class: "dim" }, [item.train_count ? `${item.train_count} training images` : null, item.class_names?.length ? `${item.class_names.length} classes` : null, item.created_at ? `added ${fmtAgo(item.created_at)}` : null].filter(Boolean).join(" · "))
            ),
            item.is_default ? pill("default", "info") : null,
            item.available === false ? pill("files missing", "warn") : null,
            h(
              "div",
              { class: "row" },
              !item.is_default
                ? button("Make default", {
                    kind: "ghost",
                    small: true,
                    iconName: "star",
                    onClick: (e) => busy(e.currentTarget, async () => {
                      const result = await window.gradapp.api("POST", `/datasets/${item.id}/default`);
                      load();
                      return result;
                    }),
                  })
                : null,
              button("", {
                kind: "ghost",
                small: true,
                iconName: "trash",
                title: `Delete ${item.name}`,
                onClick: (e) => busy(e.currentTarget, async () => {
                  const result = await window.gradapp.api("DELETE", `/datasets/${item.id}`);
                  if (result.ok) toast(`${item.name} deleted`);
                  load();
                  return result;
                }),
              })
            )
          )
        )
      );
    }

    clear(
      standard,
      importing?.running ? h("p", { class: "callout" }, `Importing ${importing.key}: ${importing.message || "working"}`) : null,
      importing?.error ? h("p", { class: "callout callout-danger" }, importing.error) : null,
      catalogue.length
        ? catalogue.map((entry) =>
            h(
              "div",
              { class: "dataset" },
              h("div", { class: "dataset-main" }, h("strong", {}, entry.name), h("span", { class: "dim" }, `${entry.images.toLocaleString()} images · ${entry.classes} class${entry.classes === 1 ? "" : "es"} · ${entry.download_mb} MB · ${entry.blurb}`)),
              button("Import", {
                kind: "secondary",
                small: true,
                disabled: Boolean(importing?.running),
                onClick: (e) => busy(e.currentTarget, async () => {
                  const result = await window.gradapp.api("POST", "/datasets/standard", { key: entry.key, make_default: !(datasets || []).length });
                  if (result.ok) toast(`Importing ${entry.name}`);
                  load();
                  return result;
                }),
              })
            )
          )
        : h("p", { class: "dim" }, "The catalogue appears once the host is connected.")
    );
  }

  draw();
  if (store.app?.target) load();
  const tick = () => {
    timer = setTimeout(async () => {
      if (importing?.running && document.visibilityState === "visible") await load();
      tick();
    }, 3000);
  };
  tick();
  const off = subscribe((reason) => {
    if (reason === "event" && /^dataset\./.test(store.events[0]?.kind || "")) load();
    if (reason === "state" && !root.contains(mine) && store.app?.target) {
      root.replaceChildren();
      draw();
      load();
    }
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
