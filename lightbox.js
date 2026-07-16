/* lightbox.js — click any content figure (image OR inline SVG) to open it
   fullscreen with wheel-zoom + drag-pan. Hub-hosted, auto-injected by each
   repo's "Inject Shared Scripts" Action. Zero-cost on pages with no figures.
   Theme-agnostic. No dependencies. */
(function () {
  "use strict";
  if (window.__lightboxLoaded) return;
  window.__lightboxLoaded = true;

  function init() {
    // Eligible: images inside <figure>/.artwork or marked data-zoom, and any
    // inline <svg> inside a <figure> or .mermaid. Skip anything opted out.
    var els = Array.prototype.slice.call(
      document.querySelectorAll(
        "figure img, .artwork img, img[data-zoom], figure svg, .mermaid svg"
      )
    ).filter(function (el) {
      return !el.classList.contains("no-zoom") &&
             !(el.closest && el.closest(".no-zoom"));
    });
    if (!els.length) return;

    var css = document.createElement("style");
    css.textContent =
      ".lb-zoomable{cursor:zoom-in}" +
      ".lb-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.92);opacity:0;transition:opacity .2s;" +
      "padding:24px;overflow:hidden;-webkit-tap-highlight-color:transparent;cursor:grab}" +
      ".lb-overlay.lb-drag{cursor:grabbing}" +
      ".lb-overlay.lb-on{opacity:1}" +
      ".lb-media{transform-origin:center center;will-change:transform;border-radius:6px;" +
      "box-shadow:0 8px 40px rgba(0,0,0,.5)}" +
      ".lb-overlay img.lb-media{max-width:94vw;max-height:90vh;width:auto;height:auto;display:block}" +
      ".lb-overlay svg.lb-media{width:min(94vw,1100px);height:auto;max-height:90vh;display:block;" +
      "background:#0f1216;padding:10px}" +
      ".lb-close{position:fixed;top:14px;right:18px;color:#fff;font-size:30px;line-height:1;" +
      "font-family:Arial,sans-serif;opacity:.7;cursor:pointer;z-index:10001;user-select:none}" +
      ".lb-close:hover{opacity:1}" +
      ".lb-hint{position:fixed;top:16px;left:0;right:0;text-align:center;color:#9aa2ab;" +
      "font-size:.72rem;font-family:monospace;pointer-events:none}" +
      ".lb-cap{position:fixed;bottom:16px;left:0;right:0;text-align:center;color:#ddd;" +
      "font-size:.8rem;padding:0 24px;pointer-events:none}";
    document.head.appendChild(css);

    var overlay, media, scale = 1, panX = 0, panY = 0,
        dragging = false, moved = false, lx = 0, ly = 0;

    function apply() {
      if (media) media.style.transform =
        "translate(" + panX + "px," + panY + "px) scale(" + scale + ")";
    }

    function close() {
      if (!overlay) return;
      var o = overlay;
      o.classList.remove("lb-on");
      setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 200);
      overlay = null; media = null; dragging = false;
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    function onMove(e) {
      if (!dragging || !media) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      panX += dx; panY += dy; lx = e.clientX; ly = e.clientY; apply();
    }
    function onUp() {
      dragging = false;
      if (overlay) overlay.classList.remove("lb-drag");
    }
    // Document-level listeners registered once (state guarded by `dragging`).
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    function open(sourceEl, captionText) {
      scale = 1; panX = 0; panY = 0; dragging = false; moved = false;
      overlay = document.createElement("div");
      overlay.className = "lb-overlay";

      if (sourceEl.tagName.toLowerCase() === "img") {
        media = document.createElement("img");
        media.src = sourceEl.currentSrc || sourceEl.src;
        media.alt = sourceEl.alt || "";
      } else {
        media = sourceEl.cloneNode(true);   // inline SVG → deep clone
        media.removeAttribute("style");
        media.removeAttribute("width");
        media.removeAttribute("height");
        media.removeAttribute("class");
      }
      media.classList.add("lb-media");
      overlay.appendChild(media);

      var x = document.createElement("div");
      x.className = "lb-close"; x.innerHTML = "&times;";
      x.setAttribute("aria-label", "Close");
      overlay.appendChild(x);

      var hint = document.createElement("div");
      hint.className = "lb-hint";
      hint.textContent = "scroll = zoom · drag = pan · Esc / click = close";
      overlay.appendChild(hint);

      if (captionText) {
        var cap = document.createElement("div");
        cap.className = "lb-cap"; cap.textContent = captionText;
        overlay.appendChild(cap);
      }

      overlay.addEventListener("wheel", function (e) {
        e.preventDefault();
        var rect = media.getBoundingClientRect();
        var ns = Math.max(0.5, Math.min(8, scale * (1 - e.deltaY * 0.0015)));
        var cx = e.clientX - (rect.left + rect.width / 2);
        var cy = e.clientY - (rect.top + rect.height / 2);
        var k = ns / scale - 1;
        panX -= cx * k; panY -= cy * k; scale = ns; apply();
      }, { passive: false });

      overlay.addEventListener("mousedown", function (e) {
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
        overlay.classList.add("lb-drag"); e.preventDefault();
      });

      overlay.addEventListener("click", function () {
        if (moved) { moved = false; return; }  // a drag, not a click
        close();
      });

      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      void overlay.offsetWidth;               // force reflow, then fade in
      overlay.classList.add("lb-on");
    }

    els.forEach(function (el) {
      el.classList.add("lb-zoomable");
      el.addEventListener("click", function () {
        var fig = el.closest("figure");
        var capEl = fig ? fig.querySelector("figcaption") : null;
        open(el, capEl ? capEl.textContent.trim() : "");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
