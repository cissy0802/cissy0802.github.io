/* lightbox.js — click any content image to open it fullscreen.
   Hub-hosted, auto-injected by each repo's "Inject Shared Scripts" Action.
   Zero-cost on pages without images. Theme-agnostic. No dependencies. */
(function () {
  "use strict";
  if (window.__lightboxLoaded) return;
  window.__lightboxLoaded = true;

  function init() {
    // Eligible: images inside <figure> or .artwork, or marked data-zoom.
    // Skip tiny icons and anything opted out with class "no-zoom".
    var imgs = Array.prototype.slice.call(
      document.querySelectorAll("figure img, .artwork img, img[data-zoom]")
    ).filter(function (img) {
      return !img.classList.contains("no-zoom");
    });
    if (!imgs.length) return;

    // Styles (injected once).
    var css = document.createElement("style");
    css.textContent =
      ".lb-zoomable{cursor:zoom-in}" +
      ".lb-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.9);opacity:0;transition:opacity .2s;" +
      "cursor:zoom-out;padding:24px;-webkit-tap-highlight-color:transparent}" +
      ".lb-overlay.lb-on{opacity:1}" +
      ".lb-overlay img{max-width:100%;max-height:100%;width:auto;height:auto;" +
      "border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5);transform:scale(.96);" +
      "transition:transform .2s}" +
      ".lb-overlay.lb-on img{transform:scale(1)}" +
      ".lb-close{position:fixed;top:14px;right:18px;color:#fff;font-size:30px;line-height:1;" +
      "font-family:Arial,sans-serif;opacity:.7;cursor:pointer;z-index:10000;user-select:none}" +
      ".lb-close:hover{opacity:1}" +
      ".lb-cap{position:fixed;bottom:16px;left:0;right:0;text-align:center;color:#ddd;" +
      "font-size:.8rem;padding:0 24px}";
    document.head.appendChild(css);

    var overlay, big, cap;

    function close() {
      if (!overlay) return;
      overlay.classList.remove("lb-on");
      var o = overlay;
      setTimeout(function () {
        if (o && o.parentNode) o.parentNode.removeChild(o);
      }, 200);
      overlay = null;
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") close();
    }

    function open(src, alt, captionText) {
      overlay = document.createElement("div");
      overlay.className = "lb-overlay";

      big = document.createElement("img");
      big.src = src;
      big.alt = alt || "";
      overlay.appendChild(big);

      var x = document.createElement("div");
      x.className = "lb-close";
      x.innerHTML = "&times;";
      x.setAttribute("aria-label", "Close");
      overlay.appendChild(x);

      if (captionText) {
        cap = document.createElement("div");
        cap.className = "lb-cap";
        cap.textContent = captionText;
        overlay.appendChild(cap);
      }

      overlay.addEventListener("click", close);
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      // force reflow then fade in
      void overlay.offsetWidth;
      overlay.classList.add("lb-on");
    }

    imgs.forEach(function (img) {
      img.classList.add("lb-zoomable");
      img.addEventListener("click", function () {
        var fig = img.closest("figure");
        var capEl = fig ? fig.querySelector("figcaption") : null;
        open(img.currentSrc || img.src, img.alt, capEl ? capEl.textContent.trim() : "");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
