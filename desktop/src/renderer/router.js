// Navigation lives apart from the shell so any screen can move to another
// without importing the whole app.

let handler = () => {};

export function onNavigate(fn) {
  handler = fn;
}

export function go(view, params) {
  handler(view, params);
}
