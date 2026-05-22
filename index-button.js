/* BigCat Learning Hub — shared "← Index" floating button.
 * On any sub-page of a category repo (e.g. /super-individual-weekly/foo-week1.html),
 * inject a fixed top-left button linking back to that category's index.
 * Sits next to the existing ← Hub button (which is hard-coded per page).
 * Skips on the hub root and on category index pages themselves.
 */
(function () {
  if (document.getElementById("bigcat-index-btn")) return; // idempotent

  // URL shape: /{repo}/{file}.html  OR  /{repo}/  OR  /
  const parts = window.location.pathname.split("/").filter(Boolean);

  // Skip hub root.
  if (parts.length === 0) return;

  // Skip if we ARE the category index (no file, or file is index.html).
  const last = parts[parts.length - 1];
  if (parts.length === 1) return; // /{repo}/  → already at index
  if (last === "index.html") return;

  const repo = parts[0];
  const indexHref = "/" + repo + "/";

  const btn = document.createElement("a");
  btn.id = "bigcat-index-btn";
  btn.href = indexHref;
  btn.textContent = "← Index";
  btn.style.cssText = [
    "position:fixed",
    "top:14px",
    "left:108px",            // sits just right of ← Hub (which is at left:14px, ~80px wide)
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

  // Insert as early as possible.
  (document.body || document.documentElement).appendChild(btn);
})();
