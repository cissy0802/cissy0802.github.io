/* BigCat Learning Hub — remember where you were on index pages.
 *
 * The hub root and each category index are long lists. Clicking ← Hub / ← Index
 * from an article is a fresh navigation, so the browser starts at the top and
 * you have to scroll all the way back down. This saves each index page's scroll
 * position in sessionStorage (shared across every repo: they all live on the
 * same origin) and puts you back there when you return through a link.
 *
 * Only index pages (hub root, /{repo}/, /{repo}/index[.en].html) are tracked —
 * opening an article should still start at its top. sessionStorage is per tab,
 * so a new tab or a new visit starts fresh.
 *
 * Loaded by the hub index pages directly and injected into every repo page by
 * index-button.js.
 */
(function () {
  if (window.__bigcatScrollMemory) return;
  window.__bigcatScrollMemory = true;

  const path = location.pathname;
  const isIndex =
    /^\/(index(\.zh|\.en)?\.html)?$/.test(path) ||
    /^\/[^/]+\/(index(\.zh|\.en)?\.html)?$/.test(path);
  if (!isIndex) return;

  // /psychology/ and /psychology/index.html are the same page. Query params
  // that change content stay in the key; UI-only ones (?me=1, utm_*) don't —
  // same rule as keyOf() in reads.js.
  const NOISE_PARAMS = /^(me|ref|fbclid|gclid|utm_[a-z]+)$/i;
  const params = new URLSearchParams(location.search);
  const keep = new URLSearchParams();
  [...params.keys()].sort().forEach((k) => {
    if (!NOISE_PARAMS.test(k)) keep.append(k, params.get(k));
  });
  const q = keep.toString();
  const key = "bigcat-scroll:" + path.replace(/index\.html$/, "") + (q ? "?" + q : "");

  function read() {
    try { return parseInt(sessionStorage.getItem(key), 10) || 0; } catch (e) { return 0; }
  }
  function save() {
    try { sessionStorage.setItem(key, String(Math.round(window.scrollY))); } catch (e) {}
  }

  // ---- restore ----
  const nav = (performance.getEntriesByType &&
    performance.getEntriesByType("navigation")[0]) || {};
  // Reload is left to the browser. A #hash means the link wants a specific spot.
  const target =
    nav.type !== "reload" && !location.hash ? read() : 0;

  let restoring = target > 0;
  function stop() { restoring = false; }
  if (restoring) {
    // Any deliberate input wins over the restore.
    ["wheel", "touchstart", "keydown", "mousedown"].forEach((ev) =>
      window.addEventListener(ev, stop, { once: true, passive: true })
    );
    // Cards, search, comment counts etc. may still be filling in, so the page
    // can be too short at first: keep nudging until it reaches the target or
    // ~6s pass (thinker-arena's index is an empty shell until its fetch lands).
    const started = Date.now();
    (function tick() {
      if (!restoring) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(target, max));
      if (max >= target && Math.abs(window.scrollY - target) < 2) {
        // Done — but one late layout shift (images/fonts) can still push it;
        // re-pin once after load settles.
        setTimeout(() => { if (restoring) window.scrollTo(0, target); restoring = false; }, 300);
        return;
      }
      if (Date.now() - started > 6000) { restoring = false; return; }
      setTimeout(tick, 80);
    })();
  }

  // ---- save ----
  let pending = false;
  window.addEventListener("scroll", () => {
    if (restoring || pending) return;
    pending = true;
    setTimeout(() => { pending = false; save(); }, 150);
  }, { passive: true });
  window.addEventListener("pagehide", () => { if (!restoring) save(); });
})();
