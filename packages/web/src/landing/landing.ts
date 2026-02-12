/**
 * Landing page interactions — theme toggle and copy-to-clipboard.
 * Vanilla JS (no framework dependency).
 */

// ── Theme toggle ──
const themeBtn = document.getElementById("theme-toggle");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sv-theme", next);
    themeBtn.setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light mode" : "Switch to dark mode",
    );
  });
}

// ── Copy install commands ──
// Supports multiple copy buttons — each copies the sibling <code> text.
document.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const codeEl = btn.parentElement?.querySelector("code");
    if (!codeEl) return;
    const text = codeEl.textContent || "";
    const originalLabel = btn.getAttribute("aria-label") || "Copy command";

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }

    btn.setAttribute("data-copied", "true");
    btn.setAttribute("aria-label", "Copied!");
    setTimeout(() => {
      btn.removeAttribute("data-copied");
      btn.setAttribute("aria-label", originalLabel);
    }, 2000);
  });
});

// ── Smooth scroll for anchor links (polyfill for Safari) ──
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    const href = (anchor as HTMLAnchorElement).getAttribute("href");
    if (!href || href === "#") return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // Update URL without scroll jump
      history.pushState(null, "", href);
    }
  });
});
