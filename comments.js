/* BigCat Learning Hub — shared Giscus comments loader + AI disclaimer.
 * Each page including this script gets a comment section mapped by pathname.
 * Comments are stored as GitHub Discussions on cissy0802/cissy0802.github.io.
 * Also injects an AI-content disclaimer above the comments section.
 * Skip on hub landing page.
 */
(function () {
  // ---------- AI 引用 disclaimer ----------
  // Only inject on content pages (skip hub landing root index).
  function injectDisclaimer() {
    if (document.getElementById("ai-disclaimer")) return;
    const path = window.location.pathname;
    // Skip on root hub page
    if (path === "/" || path === "/index.html") return;
    // Skip on per-repo landing pages (no specific content)
    const seg = path.split("/").filter(Boolean);
    if (seg.length <= 1) return;
    if (seg.length === 2 && (seg[1] === "" || seg[1].startsWith("index"))) return;

    const isEn = document.documentElement.lang && document.documentElement.lang.toLowerCase().startsWith("en");
    const msg = isEn
      ? "⚠️ Specific citations on this page (quotes, chapters, page numbers, paper claims) are AI-generated and may be inaccurate. Verify before sharing."
      : "⚠️ 本页 AI 生成的具体引用（金句、章节、页码、论文 claim）可能不准确，引用前请验证。";

    const el = document.createElement("div");
    el.id = "ai-disclaimer";
    el.style.cssText =
      "max-width:760px;margin:32px auto 0;padding:12px 16px;font-size:0.82rem;opacity:0.55;text-align:center;border-top:1px dashed rgba(127,127,127,0.4);line-height:1.5";
    el.textContent = msg;
    // Insert before <footer> if present, else at end of body
    const footer = document.querySelector("footer");
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(el, footer);
    } else {
      document.body.appendChild(el);
    }
  }
  injectDisclaimer();

  // ---------- Giscus comments ----------
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
