// One place for everything the screens show. Main pushes app state; the mesh
// snapshot is polled only while someone is looking, and slower when the view
// does not need it, so a hidden GradApp costs nothing.

const listeners = new Set();

export const store = {
  app: null,
  hardware: null,
  mesh: null,
  meshError: null,
  meshAt: 0,
  logs: [],
  events: [],
  update: null,
  view: "home",
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let scheduled = false;
export function emit(reason) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const listener of listeners) listener(reason);
  });
}

const FAST_VIEWS = new Set(["home", "mesh", "runs"]);
let pollTimer = null;
let inflight = false;

export async function refreshMesh() {
  if (inflight) return;
  if (!store.app?.target) {
    if (store.mesh) {
      store.mesh = null;
      emit("mesh");
    }
    return;
  }
  inflight = true;
  try {
    const result = await window.gradapp.api("GET", "/mesh");
    if (result.ok) {
      store.mesh = result.data;
      store.meshError = null;
    } else {
      store.meshError = result.error;
    }
    store.meshAt = Date.now();
    emit("mesh");
  } finally {
    inflight = false;
  }
}

function schedule() {
  clearTimeout(pollTimer);
  if (document.visibilityState !== "visible") return;
  const delay = FAST_VIEWS.has(store.view) ? 3000 : 12000;
  pollTimer = setTimeout(async () => {
    await refreshMesh();
    schedule();
  }, delay);
}

export function startPolling() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshMesh().then(schedule);
    else clearTimeout(pollTimer);
  });
  refreshMesh().then(schedule);
}

export function setView(view) {
  store.view = view;
  schedule();
}

export function pushLog(entry) {
  store.logs.push(entry);
  if (store.logs.length > 1500) store.logs.splice(0, store.logs.length - 1500);
  emit("log");
}

export function pushEvent(event) {
  if (!event || event.kind === "stream.ready") return;
  if (store.events.some((existing) => existing.id === event.id && existing.at === event.at)) return;
  store.events.unshift(event);
  if (store.events.length > 200) store.events.length = 200;
  emit("event");
  // Something changed on the mesh; refresh now instead of waiting a tick.
  if (/^(node|run|round|dataset)\./.test(event.kind)) refreshMesh();
}
