/* BigCat Learning Hub — shared Pagefind search loader.
 * Adds a floating 🔍 button on every page. Click (or press "/") to open
 * a modal that queries the Pagefind index hosted at /pagefind/ on the hub.
 */
(function () {
  if (document.getElementById("search-fab")) return; // idempotent
  const HUB = "https://cissy0802.github.io";

  // Detect dark mode like comments.js
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

  // Floating search button
  const fab = document.createElement("button");
  fab.id = "search-fab";
  fab.setAttribute("aria-label", "搜索全站");
  fab.title = "搜索全站 (按 / 触发)";
  fab.innerHTML = "🔍";
  fab.style.cssText =
    "position:fixed;bottom:22px;right:22px;z-index:9998;width:48px;height:48px;border-radius:50%;border:none;" +
    "background:rgba(123,97,255,0.92);color:#fff;font-size:20px;cursor:pointer;" +
    "box-shadow:0 4px 14px rgba(0,0,0,0.3);transition:transform 0.15s ease,box-shadow 0.15s ease;" +
    "display:flex;align-items:center;justify-content:center;line-height:1";
  fab.onmouseenter = () => {
    fab.style.transform = "scale(1.08)";
    fab.style.boxShadow = "0 6px 20px rgba(0,0,0,0.4)";
  };
  fab.onmouseleave = () => {
    fab.style.transform = "scale(1)";
    fab.style.boxShadow = "0 4px 14px rgba(0,0,0,0.3)";
  };

  // Modal overlay
  const overlay = document.createElement("div");
  overlay.id = "search-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:none;" +
    "justify-content:center;align-items:flex-start;padding:80px 20px 20px;backdrop-filter:blur(6px)";

  const modal = document.createElement("div");
  modal.style.cssText =
    `background:${dark ? "#16213e" : "#ffffff"};color:${dark ? "#e4e6eb" : "#1f1f1f"};` +
    "border-radius:14px;width:100%;max-width:680px;max-height:80vh;overflow:auto;" +
    "padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,0.5);position:relative";
  modal.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">' +
      '<h3 style="margin:0;font-size:1.1rem;font-weight:600">🔍 搜索全站</h3>' +
      '<span style="font-size:0.75rem;opacity:0.55">Esc 关闭</span>' +
    '</div>' +
    '<div id="pagefind-search"></div>';
  overlay.appendChild(modal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  let uiInitialized = false;
  function openSearch() {
    overlay.style.display = "flex";
    if (!uiInitialized) initPagefind();
    setTimeout(() => {
      const input = modal.querySelector('input[type="text"]');
      if (input) input.focus();
    }, 80);
  }
  function closeSearch() {
    overlay.style.display = "none";
  }
  fab.addEventListener("click", openSearch);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display === "flex") {
      closeSearch();
      return;
    }
    if (
      e.key === "/" &&
      !e.target.matches("input, textarea, [contenteditable]") &&
      overlay.style.display !== "flex"
    ) {
      e.preventDefault();
      openSearch();
    }
  });

  function initPagefind() {
    uiInitialized = true;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${HUB}/pagefind/pagefind-ui.css`;
    document.head.appendChild(css);

    // Light tweak so the UI inherits the modal's theme
    const style = document.createElement("style");
    style.textContent = `
      #pagefind-search { --pagefind-ui-scale: 0.92; --pagefind-ui-primary: #7b61ff;
        --pagefind-ui-text: ${dark ? "#e4e6eb" : "#1f1f1f"};
        --pagefind-ui-background: ${dark ? "#16213e" : "#ffffff"};
        --pagefind-ui-border: ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"};
        --pagefind-ui-tag: ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"};
      }
      #pagefind-search .pagefind-ui__result-link { color: ${dark ? "#00d4ff" : "#7b61ff"} !important; }
    `;
    document.head.appendChild(style);

    const script = document.createElement("script");
    script.src = `${HUB}/pagefind/pagefind-ui.js`;
    script.onload = () => {
      try {
        new PagefindUI({
          element: "#pagefind-search",
          showSubResults: true,
          pageSize: 5,
          bundlePath: `${HUB}/pagefind/`,
          // Thinking Hub debates are indexed via static snapshots under
          // /thinker-arena/search/<slug>.html (the live page renders client-side,
          // so Pagefind can't crawl it directly). Those snapshot files aren't
          // shipped — only the index is — so rewrite their result URLs back to the
          // live interactive debate page. The generator stores that live URL in
          // meta.url; fall back to parsing the snapshot slug if meta is missing.
          processResult: (result) => {
            const live =
              (result.meta && result.meta.url) ||
              (() => {
                const m = /\/thinker-arena\/search\/(.+?)(?:\.en)?\.html$/.exec(
                  result.url || ""
                );
                return m ? `/thinker-arena/debate.html?id=${m[1]}` : null;
              })();
            if (live) {
              result.url = live;
              (result.sub_results || []).forEach((s) => {
                s.url = live;
              });
            }
            return result;
          },
          translations: {
            placeholder: "搜索全站内容（含圆桌辩论）...",
            zero_results: "未找到相关结果",
            many_results: "[COUNT] 条结果",
            one_result: "1 条结果",
            searching: "搜索中...",
          },
        });
      } catch (err) {
        modal.querySelector("#pagefind-search").innerHTML =
          '<p style="opacity:0.7">搜索索引尚未生成或加载失败。请等待 GitHub Action 完成首次构建。</p>';
      }
    };
    script.onerror = () => {
      modal.querySelector("#pagefind-search").innerHTML =
        '<p style="opacity:0.7">搜索索引尚未生成。请等待 GitHub Action 完成首次构建（每天 6am PDT 自动刷新）。</p>';
    };
    document.head.appendChild(script);
  }

  document.body.appendChild(fab);
  document.body.appendChild(overlay);
})();
