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
  // The Pagefind bundle is served by the bigcat-search Worker out of R2, not by
  // whatever host serves this page. It used to be same-origin and committed to
  // the site repo, but ~3100 files / 46MB rebuilt nightly had pushed .git past
  // 700MB. Cross-origin is safe here in a way a bare github.io URL never was:
  // the Worker sets Access-Control-Allow-Origin for the hub's origins and never
  // redirects (a 301 is what silently kills CORS on GitHub Pages).
  const HUB = "https://bigcat-search.cissychen.workers.dev";

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
        tabFind: "Keywords",
        tabAsk: "Ask",
        askPlaceholder: "Ask a question about these essays…",
        askHint: "Answered only from what's written here, with the pages it drew on.",
        askSubmit: "Ask",
        askThinking: "Reading…",
        askSources: "Sources",
        askEmpty: "Nothing here covers that.",
        askError: "Couldn't reach the answering service. Try again in a moment.",
        askQuota: "Today's answering allowance is used up. Keyword search still works.",
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
        tabFind: "关键词",
        tabAsk: "问一句",
        askPlaceholder: "就站内文章提个问题…",
        askHint: "只根据站内已有内容作答，并附上依据的文章。",
        askSubmit: "提问",
        askThinking: "正在读…",
        askSources: "依据",
        askEmpty: "站内没有讲到这个。",
        askError: "问答服务连不上，稍后再试。",
        askQuota: "今天的问答额度用完了，关键词搜索不受影响。",
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
  // Two ways to look, because they fail in opposite directions: keywords find
  // the pages containing a term and are useless for "哪几篇讲过决策疲劳";
  // asking handles the question but can't be trusted to enumerate exhaustively.
  const tabStyle = (on) =>
    "flex:1;padding:7px 10px;border:none;border-radius:7px;cursor:pointer;font:inherit;font-size:0.85rem;" +
    "transition:background 0.15s ease,color 0.15s ease;" +
    (on
      ? "background:rgba(123,97,255,0.9);color:#fff;"
      : `background:transparent;color:${dark ? "#9aa0b5" : "#5b6070"};`);

  modal.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">' +
      '<h3 style="margin:0;font-size:1.1rem;font-weight:600">' + T.header + '</h3>' +
      '<span style="font-size:0.75rem;opacity:0.55">' + T.esc + '</span>' +
    '</div>' +
    '<div id="mode-tabs" style="display:flex;gap:4px;padding:4px;margin-bottom:14px;border-radius:9px;' +
      `background:${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}">` +
      '<button id="tab-find" type="button"></button>' +
      '<button id="tab-ask" type="button"></button>' +
    '</div>' +
    '<div id="pagefind-search"></div>' +
    '<div id="ask-panel" style="display:none">' +
      '<textarea id="ask-input" rows="2" style="width:100%;box-sizing:border-box;resize:vertical;' +
        'padding:10px 12px;border-radius:8px;font:inherit;font-size:0.92rem;' +
        `background:${dark ? "rgba(255,255,255,0.06)" : "#fff"};color:inherit;` +
        `border:1px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}"></textarea>` +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:8px">' +
        '<span id="ask-hint" style="font-size:0.72rem;opacity:0.55;line-height:1.4"></span>' +
        '<button id="ask-submit" type="button" style="flex:none;padding:7px 16px;border:none;border-radius:7px;' +
          'background:rgba(123,97,255,0.92);color:#fff;font:inherit;font-size:0.85rem;cursor:pointer"></button>' +
      '</div>' +
      '<div id="ask-status" style="margin-top:14px;font-size:0.85rem;opacity:0.7"></div>' +
      '<div id="ask-answer" style="margin-top:12px;font-size:0.94rem;line-height:1.75;white-space:pre-wrap"></div>' +
      '<div id="ask-sources" style="margin-top:16px"></div>' +
    '</div>';
  overlay.appendChild(modal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  /* ---- 问一句 / Ask -------------------------------------------------------
   * Semantic retrieval + a grounded answer, from the bigcat-ask-api Worker.
   * Everything the model produces is inserted as text, never as HTML: it is
   * generated from page content, which makes it exactly the kind of string that
   * should never reach innerHTML. Links are built from the Worker's own URL
   * mapping rather than from anything the model wrote.
   */
  const ASK_API = "https://bigcat-ask-api.cissychen.workers.dev";
  const tabFind = modal.querySelector("#tab-find");
  const tabAsk = modal.querySelector("#tab-ask");
  const askPanel = modal.querySelector("#ask-panel");
  const findPanel = modal.querySelector("#pagefind-search");
  const askInput = modal.querySelector("#ask-input");
  const askSubmit = modal.querySelector("#ask-submit");
  const askStatus = modal.querySelector("#ask-status");
  const askAnswer = modal.querySelector("#ask-answer");
  const askSources = modal.querySelector("#ask-sources");

  tabFind.textContent = T.tabFind;
  tabAsk.textContent = T.tabAsk;
  askInput.placeholder = T.askPlaceholder;
  askSubmit.textContent = T.askSubmit;
  modal.querySelector("#ask-hint").textContent = T.askHint;

  let mode = "find";
  function setMode(next) {
    mode = next;
    const asking = next === "ask";
    tabFind.style.cssText = tabStyle(!asking);
    tabAsk.style.cssText = tabStyle(asking);
    findPanel.style.display = asking ? "none" : "";
    askPanel.style.display = asking ? "" : "none";
    const focusTarget = asking ? askInput : modal.querySelector('input[type="text"]');
    if (focusTarget) setTimeout(() => focusTarget.focus(), 40);
  }
  tabFind.addEventListener("click", () => setMode("find"));
  tabAsk.addEventListener("click", () => setMode("ask"));

  let asking = false;
  async function ask() {
    const q = askInput.value.trim();
    if (!q || asking) return;
    asking = true;
    askSubmit.disabled = true;
    askSubmit.style.opacity = "0.5";
    askStatus.textContent = T.askThinking;
    askAnswer.textContent = "";
    askSources.textContent = "";
    try {
      const res = await fetch(ASK_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      if (res.status === 429) {
        askStatus.textContent = T.askQuota;
        return;
      }
      if (!res.ok) throw new Error(data && data.error);
      askStatus.textContent = "";
      askAnswer.textContent = data.answer || T.askEmpty;
      renderSources(data.sources || []);
    } catch (e) {
      askStatus.textContent = T.askError;
    } finally {
      asking = false;
      askSubmit.disabled = false;
      askSubmit.style.opacity = "";
    }
  }

  function renderSources(sources) {
    askSources.textContent = "";
    if (!sources.length) return;
    const label = document.createElement("div");
    label.textContent = T.askSources;
    label.style.cssText =
      "font-size:0.72rem;letter-spacing:0.06em;text-transform:uppercase;opacity:0.5;margin-bottom:8px";
    askSources.appendChild(label);
    sources.slice(0, 5).forEach((s) => {
      const a = document.createElement("a");
      a.href = s.url;
      a.rel = "noopener";
      a.textContent = s.title || s.url;
      a.style.cssText =
        `display:block;padding:7px 10px;margin-bottom:5px;border-radius:7px;text-decoration:none;font-size:0.86rem;` +
        `color:${dark ? "#00d4ff" : "#7b61ff"};background:${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)"}`;
      askSources.appendChild(a);
    });
  }

  askSubmit.addEventListener("click", ask);
  askInput.addEventListener("keydown", (e) => {
    // Enter asks; Shift+Enter is a newline, since questions can run long.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });
  setMode("find");

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

  /* CJK queries: exact phrase, then bigrams, then raw.
   *
   * Pagefind drops query terms that aren't in the index instead of returning
   * zero results, so an unquoted Chinese phrase degrades into whatever fragment
   * IS indexed — "现象学" once matched 1172 pages by collapsing to "现象".
   * Quoting forces an exact-phrase match: 27 pages, exactly the ones containing
   * the string. That's tier one, and it's right for most queries.
   *
   * It can't be the only tier, for two different reasons:
   *   - For some terms, proper names especially, the query-side segmenter
   *     disagrees with the index-side one and the phrase matches nothing
   *     ("海德格尔" → 0 quoted, 15 unquoted).
   *   - A word that only ever appears inside a compound is in no token at all
   *     ("拓扑" lives in 拓扑学 / 拓扑指纹 / 拓扑不变). That's what the bigram
   *     shadow text in the build exists for: querying its overlapping 2-char
   *     windows finds the compound.
   *
   * So each term is probed once, in that order, and the winning mode is cached.
   * Latin queries are left alone — quoting them would silently turn every
   * multi-word search into a phrase search.
   */
  const HAS_CJK = /[㐀-鿿぀-ヿ]/;
  const termMode = new Map(); // term -> "quoted" | "bigram" | "raw"

  // Overlapping 2-char windows over each CJK run, encoded exactly as the build
  // encodes them: 现象学 -> "bg73b0象... " i.e. one opaque ASCII word per pair.
  // They are NOT sent as Chinese: Pagefind's segmenter re-segments CJK shadow
  // text and dissolves the pairs into mostly single-char tokens, which put
  // 贝叶斯 at 75 results against the 24 pages that contain it. Hex codepoints
  // are a single Latin term to the tokenizer. Keep in step with the build.
  const hex = (c) => c.charCodeAt(0).toString(16).padStart(4, "0");
  function bigrams(term) {
    const out = [];
    (term.match(/[㐀-鿿]{2,}/g) || []).forEach((run) => {
      for (let i = 0; i < run.length - 1; i++) {
        out.push("bg" + hex(run[i]) + hex(run[i + 1]));
      }
    });
    return out.length ? out.join(" ") : term;
  }
  let pfModule = null;
  let ui = null;
  let hasBigrams = false; // set by the warm-up probe, see warmProbeIndex

  // A second Pagefind instance, used only to test whether the quoted form of a
  // term matches anything. Warmed at modal-open time: cold, its first query
  // costs seconds (module + wasm + index chunks) and the correction lands long
  // after the user has seen the wrong result count. Warm, probes run in ~15ms —
  // inside PagefindUI's own debounce window, so the retry is invisible.
  function warmProbeIndex() {
    pfModule =
      pfModule ||
      import(`${HUB}/pagefind/pagefind.js`).then(async (pf) => {
        // Must be a real query, and we must wait for it: on an instance whose
        // index chunks haven't loaded, search() answers "0 results" in ~1ms.
        // Probing against that state would cache a bogus verdict for the term.
        try {
          await pf.search("的");
          // Does this index actually carry the build's bigram shadow text? On
          // one that doesn't, the bigram tier is actively harmful: it matches a
          // few stray word tokens and short-circuits the raw tier that would
          // have answered properly (海德格尔 went 15 results → 6 that way).
          //
          // Quoted, and more than one hit required: unquoted, Pagefind partial-
          // matches the marker's "pf" prefix against a Mermaid diagram in an
          // LLM-serving article, and that single stray hit is enough to turn the
          // tier on. The real marker sits on every CJK page, so it lands in the
          // hundreds.
          hasBigrams = (await pf.search('"pfbigramv2"')).results.length > 1;
        } catch (e) {}
        return pf;
      });
  }

  // While a term is being probed, the UI may be showing the quoted search's
  // "no results" — a verdict we're about to overturn. Hide that message until
  // the probe lands so the fallback doesn't read as a flash of "未找到".
  let probing = 0;
  function markProbing(delta) {
    probing = Math.max(0, probing + delta);
    const el = modal.querySelector("#pagefind-search");
    if (el) el.toggleAttribute("data-probing", probing > 0);
  }

  function probeTerm(term) {
    termMode.set(term, "quoted"); // optimistic; corrected below if empty
    warmProbeIndex();
    markProbing(1);
    const bg = bigrams(term);
    // Never leave the message hidden if a probe hangs, or if the fallback
    // search that follows one takes longer than this to render.
    const safety = setTimeout(() => markProbing(-1), 3500);
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      clearTimeout(safety);
      markProbing(-1);
    };
    pfModule
      .then(async (pf) => {
        if ((await pf.search('"' + term + '"')).results.length) return "quoted";
        if (hasBigrams && bg !== term && (await pf.search(bg)).results.length) {
          return "bigram";
        }
        return "raw";
      })
      .then((mode) => {
        // On the quoted-is-fine path the UI's own render is already correct, so
        // stop hiding immediately. On the fallback paths keep it hidden until
        // the re-run renders — that gap is the "未找到" flash we're avoiding.
        if (mode === "quoted") return done();
        termMode.set(term, mode);
        // Re-run the search now that processTerm will hand over the raw term.
        // triggerSearch() writes a Svelte prop, so handing it the string the UI
        // already holds is a no-op — it has to differ. A zero-width space does
        // the job: invisible in the box, and processTerm strips it back out, so
        // both the query and anything the user types next are unaffected.
        const input = modal.querySelector('input[type="text"]');
        const current = input ? cleanTerm(input.value) : term;
        if (!ui || current !== term) return done();
        ui.triggerSearch(term + "​");
        // Take the sentinel back out of the box once the re-run has picked it
        // up (no event — that would search again). Left in, the user's next
        // backspace would delete an invisible char and appear to do nothing.
        setTimeout(() => {
          if (input && input.value !== cleanTerm(input.value)) {
            input.value = cleanTerm(input.value);
          }
        }, 400);
        // Reveal the count again the moment the re-run has replaced the zero
        // message, rather than waiting out the safety timeout.
        const root = modal.querySelector("#pagefind-search");
        if (!root || !window.MutationObserver) return;
        const obs = new MutationObserver(() => {
          const m = root.querySelector(".pagefind-ui__message");
          const txt = m ? m.textContent.trim() : "";
          if (txt && txt !== T.zero) {
            obs.disconnect();
            done();
          }
        });
        obs.observe(root, { childList: true, subtree: true, characterData: true });
        setTimeout(() => obs.disconnect(), 3500);
      })
      .catch(() => {
        done();
        termMode.set(term, "raw");
      });
  }

  /* A bigram-mode hit matches inside the build's hidden shadow block, and
   * Pagefind builds excerpts from wherever the match is — so the snippet comes
   * back as a run of "bg8d1d53f6" tokens. Detect that shape and show the head
   * of the real prose instead. Costs the <mark> highlighting on those results,
   * which is a fair trade against unreadable output.
   */
  const SOUP = /(?:bg[0-9a-f]{8}\s+){3,}/;
  function deSoup(result) {
    const strip = (s) => (s || "").replace(/<[^>]+>/g, "");
    const fix = (obj) => {
      if (!obj || !SOUP.test(strip(obj.excerpt))) return;
      const prose = strip(result.content)
        .replace(/(?:\bbg[0-9a-f]{8}\s*)+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (prose) obj.excerpt = prose.slice(0, 180) + (prose.length > 180 ? "…" : "");
    };
    fix(result);
    (result.sub_results || []).forEach(fix);
  }

  function cleanTerm(term) {
    return (term || "").replace(/​/g, "").trim();
  }

  function processTerm(term) {
    const t = cleanTerm(term);
    if (!t || !HAS_CJK.test(t)) return term;
    const mode = termMode.get(t);
    if (mode === "raw") return t;
    if (mode === "bigram") return bigrams(t);
    if (!mode) probeTerm(t);
    return '"' + t + '"';
  }

  function initPagefind() {
    uiInitialized = true;
    warmProbeIndex();
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
      #pagefind-search[data-probing] .pagefind-ui__message { visibility: hidden; }
    `;
    document.head.appendChild(style);

    const script = document.createElement("script");
    script.src = `${HUB}/pagefind/pagefind-ui.js`;
    script.onload = () => {
      try {
        ui = new PagefindUI({
          element: "#pagefind-search",
          showSubResults: true,
          pageSize: 5,
          bundlePath: `${HUB}/pagefind/`,
          processTerm,
          // Thinking Hub debates are indexed via static snapshots under
          // /thinker-arena/search/<slug>.html (the live page renders client-side,
          // so Pagefind can't crawl it directly). Those snapshot files aren't
          // shipped — only the index is — so rewrite their result URLs back to the
          // live interactive debate page. The generator stores that live URL in
          // meta.url; fall back to parsing the snapshot slug if meta is missing.
          processResult: (result) => {
            // Pagefind stores result paths relative to the bundle and resolves
            // them against wherever the bundle is served from — which is now the
            // R2 Worker, not the site. Left alone, every result links to
            // bigcat-search.cissychen.workers.dev/<page>.html and 404s. Strip the
            // bundle origin back off to get the site-root path the page lives at.
            const unbundle = (u) =>
              u && u.startsWith(HUB) ? u.slice(HUB.length) : u;
            result.url = unbundle(result.url);
            (result.sub_results || []).forEach((s) => {
              s.url = unbundle(s.url);
            });
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
            deSoup(result);
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
