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
  // Category index page (/{repo}/, /{repo}/index.html, /{repo}/index.en.html):
  // still show ← Hub, but skip ← Index (it would just point to this same page).
  const isCategoryIndex =
    parts.length === 1 || last === "index.html" || last === "index.en.html";

  const repo = parts[0];

  // Single-page sites that carry language via localStorage + ?lang= (no .en.html
  // files). Their English "index" is the same dir, not an index.en.html.
  const LOCALE_PERSIST_REPOS = ["thinker-arena"];
  const isLocalePersist = LOCALE_PERSIST_REPOS.includes(repo);

  // Detect current page language so the buttons return to the same language.
  // Priority: <html lang> attribute, then URL filename (.en.html), then ?lang=.
  const htmlLang = (document.documentElement.lang || "").toLowerCase();
  const urlLang = new URLSearchParams(window.location.search).get("lang");
  const isEn =
    htmlLang.startsWith("en") || /\.en\.html$/i.test(last) || urlLang === "en";
  const hubHref = isEn
    ? "https://cissy0802.github.io/index.en.html"
    : "https://cissy0802.github.io/";
  const indexHref = isLocalePersist
    ? "/" + repo + "/" + (isEn ? "?lang=en" : "")
    : isEn
    ? "/" + repo + "/index.en.html"
    : "/" + repo + "/";

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

  // Detect existing hardcoded ← Hub button (any fixed/floating anchor pointing to the hub root).
  // Returns the anchor element if found, else null.
  function findExistingHubBtn() {
    const byId = document.getElementById("bigcat-hub-btn");
    if (byId) return byId;
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
          return a;
        }
      }
    }
    return null;
  }

  const root = document.body || document.documentElement;

  // 1) ← Hub button (left:14px).
  const existingHub = findExistingHubBtn();
  if (existingHub) {
    // Self-heal: on an EN page, a hardcoded ← Hub pointing at the zh hub root
    // would send the reader to the Chinese hub. Correct it to the EN hub.
    if (isEn) {
      const h = existingHub.getAttribute("href") || "";
      if (/^https?:\/\/cissy0802\.github\.io\/?$/.test(h) || h === "/") {
        existingHub.setAttribute("href", hubHref);
      }
    }
  } else {
    root.appendChild(makeBtn("bigcat-hub-btn", hubHref, "← Hub", 14));
  }

  // 2) ← Index button (left:108px) — inject on content sub-pages only,
  //    not on the category index itself (would point to this same page).
  if (!isCategoryIndex && !document.getElementById("bigcat-index-btn")) {
    root.appendChild(makeBtn("bigcat-index-btn", indexHref, "← Index", 108));
  }
})();
