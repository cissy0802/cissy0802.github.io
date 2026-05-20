/* BigCat Learning Hub — shared Giscus comments loader.
 * Each page including this script gets a comment section mapped by pathname.
 * Comments are stored as GitHub Discussions on cissy0802/cissy0802.github.io.
 * Skip on hub landing page.
 */
(function () {
  if (document.getElementById("giscus-container")) return; // idempotent

  // Detect page background luminance and pick a matching Giscus theme.
  function pageIsDark() {
    let el = document.body;
    while (el) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
        const m = c.match(/\d+(?:\.\d+)?/g);
        if (m && m.length >= 3) {
          const lum = m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114;
          return lum < 128;
        }
      }
      el = el.parentElement;
    }
    return false;
  }
  const dark = pageIsDark();
  const theme = dark ? "noborder_dark" : "light";

  const container = document.createElement("section");
  container.id = "giscus-container";
  container.style.cssText =
    "max-width:760px;margin:56px auto 24px;padding:28px 20px 8px;border-top:1px solid rgba(127,127,127,0.22)";
  container.innerHTML =
    '<h3 style="font-size:1.05rem;font-weight:600;margin-bottom:18px;letter-spacing:1px;opacity:0.78">💬 评论 · Comments</h3>';

  // Insert just before <footer> if present, else at end of body
  const footer = document.querySelector("footer");
  if (footer && footer.parentNode) {
    footer.parentNode.insertBefore(container, footer);
  } else {
    document.body.appendChild(container);
  }

  const s = document.createElement("script");
  s.src = "https://giscus.app/client.js";
  s.async = true;
  s.crossOrigin = "anonymous";
  s.setAttribute("data-repo", "cissy0802/cissy0802.github.io");
  s.setAttribute("data-repo-id", "R_kgDOShlsYQ");
  s.setAttribute("data-category", "General");
  s.setAttribute("data-category-id", "DIC_kwDOShlsYc4C9f-A");
  s.setAttribute("data-mapping", "pathname");
  s.setAttribute("data-strict", "0");
  s.setAttribute("data-reactions-enabled", "1");
  s.setAttribute("data-emit-metadata", "0");
  s.setAttribute("data-input-position", "top");
  s.setAttribute("data-theme", theme);
  s.setAttribute("data-lang", "zh-CN");
  s.setAttribute("data-loading", "lazy");
  container.appendChild(s);
})();
