/* Cloudflare Web Analytics — cookieless, no personal tracking.
 * It rides in search.js because this is the ONE shared script present on every
 * page type: injected content pages, the hub index, thinker-arena, and 404.html
 * (comments.js is absent from the latter two). One file, whole-site coverage.
 * Kept in its own IIFE so it never gets skipped by the search widget's
 * early-return guard below.
 */
(function () {
  if (document.getElementById("cf-beacon")) return; // idempotent
  var b = document.createElement("script");
  b.id = "cf-beacon";
  b.src = "https://static.cloudflareinsights.com/beacon.min.js";
  b.setAttribute(
    "data-cf-beacon",
    '{"token": "1abb700a9196414abe5075adadc38282"}'
  );
  (document.head || document.documentElement).appendChild(b);
})();

/* BigCat Learning Hub — shared Pagefind search loader.
 * Adds a floating 🔍 button on every page. Click (or press "/") to open
 * a modal that queries the Pagefind index hosted at /pagefind/ on the hub.
 */
(function () {
  if (document.documentElement.hasAttribute("data-no-hub-nav")) return;
  if (document.getElementById("search-fab")) return; // idempotent
  // Pagefind assets/index are loaded SAME-ORIGIN (root-relative). Must not be a
  // hardcoded absolute host: once the hub serves from hub.cissychen.com, an
  // absolute cissy0802.github.io URL becomes a cross-origin fetch that 301s and
  // gets CORS-blocked (GitHub Pages sends no ACAO header) — which silently kills
  // search. "" keeps every /pagefind/ request on whatever domain serves the page.
  const HUB = "";

  // Detect page language so the search overlay matches it (EN pages must not open in Chinese).
  // Priority: <html lang>, then .en.html filename, then ?lang=en.
  const _last = location.pathname.split("/").filter(Boolean).pop() || "";
  const isEn =
    (document.documentElement.lang || "").toLowerCase().startsWith("en") ||
    /\.en\.html$/i.test(_last) ||
    new URLSearchParams(location.search).get("lang") === "en";
  const T = isEn
    ? {
        aria: "Search the site",
        title: "Search the site (press /)",
        header: "🔍 Search",
        esc: "Esc to close",
        placeholder: "Search everything (incl. roundtable debates)…",
        zero: "No results found",
        many: "[COUNT] results",
        one: "1 result",
        searching: "Searching…",
        errBuilt: "Search index isn't built yet, or it failed to load. Please wait for the GitHub Action's first build.",
        errPending: "Search index isn't built yet. Please wait for the GitHub Action's first build (auto-refreshes daily at 6am PDT).",
      }
    : {
        aria: "搜索全站",
        title: "搜索全站 (按 / 触发)",
        header: "🔍 搜索全站",
        esc: "Esc 关闭",
        placeholder: "搜索全站内容（含圆桌辩论）...",
        zero: "未找到相关结果",
        many: "[COUNT] 条结果",
        one: "1 条结果",
        searching: "搜索中...",
        errBuilt: "搜索索引尚未生成或加载失败。请等待 GitHub Action 完成首次构建。",
        errPending: "搜索索引尚未生成。请等待 GitHub Action 完成首次构建（每天 6am PDT 自动刷新）。",
      };

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
  fab.setAttribute("aria-label", T.aria);
  fab.title = T.title;
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
      '<h3 style="margin:0;font-size:1.1rem;font-weight:600">' + T.header + '</h3>' +
      '<span style="font-size:0.75rem;opacity:0.55">' + T.esc + '</span>' +
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
            placeholder: T.placeholder,
            zero_results: T.zero,
            many_results: T.many,
            one_result: T.one,
            searching: T.searching,
          },
        });
      } catch (err) {
        modal.querySelector("#pagefind-search").innerHTML =
          '<p style="opacity:0.7">' + T.errBuilt + '</p>';
      }
    };
    script.onerror = () => {
      modal.querySelector("#pagefind-search").innerHTML =
        '<p style="opacity:0.7">' + T.errPending + '</p>';
    };
    document.head.appendChild(script);
  }

  document.body.appendChild(fab);
  document.body.appendChild(overlay);
})();
