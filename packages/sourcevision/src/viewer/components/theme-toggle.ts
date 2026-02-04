import { h } from "preact";
import { useState } from "preact/hooks";

export function initTheme() {
  const stored = localStorage.getItem("sv-theme");
  const preferred =
    stored || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", preferred);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark"
  );

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sv-theme", next);
    setTheme(next);
  };

  return h("button", {
    class: "theme-toggle-btn",
    onClick: toggle,
    title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  }, theme === "dark" ? "\u2600" : "\u263E");
}
