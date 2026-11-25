export function applyTheme(t) {
  document.documentElement.classList.toggle("dark", t === "dark");
  localStorage.setItem("theme", t);
}

export function initTheme() {
  const saved = localStorage.getItem("theme");
  const t = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(t);
  return t;
}