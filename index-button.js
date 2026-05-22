/* BigCat Learning Hub — shared floating nav buttons.
 * Injects "← Hub" (if missing) and "← Index" buttons in the top-left corner
 * of every content sub-page. Idempotent: skips either button if one already
 * exists (some pages hard-code ← Hub in their HTML).
 * Skips on the hub root and on category index pages themselves.
 */
(function () {
  // URL shape: /{repo}/{file}.html  OR  /{repo}/  OR  /
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return; // hub root
  const last = parts[parts.length - 1];
  if (parts.length === 1) return; // /{repo}/  → already at category index
  if (last === "index.html") return;

  const repo = parts[0];

  function makeBtn(id, href, text, left) {
    const btn = document.createElement("a");
    btn.id = id;
    btn.href = href;
    btn.textContent = text;
    btn.style.cssText = [
      "position:fixed",
      "top:14px",
      "left:" + left + "px",
      "font-size:0.82rem",
      "color:inherit",
      "opacity:0.55",
      "text-decoration:none",
      "padding:6px 12px",
      "border:1px solid currentColor",
      "border-radius:20px",
      "z-index:100",
      "backdrop-filter:blur(6px)",
      "transition:opacity 0.2s",
    ].join(";");
    btn.addEventListener("mouseover", () => (btn.style.opacity = 1));
    btn.addEventListener("mouseout", () => (btn.style.opacity = 0.55));
    return btn;
  }

  // Detect existing hardcoded ← Hub button (matches any anchor pointing to the hub root).
  function hasExistingHubBtn() {
    if (document.getElementById("bigcat-hub-btn")) return true;
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href) continue;
      // Match common forms: "https://cissy0802.github.io/", "/", "../", "https://..../"
      const isHubHref =
        href === "https://cissy0802.github.io/" ||
        href === "https://cissy0802.github.io" ||
        href === "/" ||
        /^https?:\/\/cissy0802\.github\.io\/?$/.test(href);
      if (isHubHref) {
        // Only count if it looks like a fixed/floating nav button, not a footer link.
        const style = (a.getAttribute("style") || "").toLowerCase();
        if (style.includes("position:fixed") || style.includes("position: fixed")) {
          return true;
        }
      }
    }
    return false;
  }

  const root = document.body || document.documentElement;

  // 1) ← Hub button (left:14px) — inject only if no existing hub button.
  if (!hasExistingHubBtn()) {
    root.appendChild(makeBtn("bigcat-hub-btn", "https://cissy0802.github.io/", "← Hub", 14));
  }

  // 2) ← Index button (left:108px) — always inject if not present.
  if (!document.getElementById("bigcat-index-btn")) {
    root.appendChild(makeBtn("bigcat-index-btn", "/" + repo + "/", "← Index", 108));
  }
})();
