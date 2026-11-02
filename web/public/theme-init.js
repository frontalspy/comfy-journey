// Applies a saved light/dark choice before first paint, so there is no flash of the wrong theme.
try {
  const saved = JSON.parse(localStorage.getItem("comfy.theme") ?? "null");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  // Storage unavailable: follow the system theme.
}
