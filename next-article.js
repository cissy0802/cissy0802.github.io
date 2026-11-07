/* BigCat Learning Hub — "next article" link at the bottom of every content page.
 *
 * Loaded on every content page by index-button.js. Reads this repo's own index
 * (index.html or index.en.html, matching the page's language), takes the
 * published entries in index order, and links to the one after this page — so
 * a reader can keep going without a trip back to the index.
 *
 * Same reading order as the audio auto-continue in i18n-tts.js: the `.entry`
 * links are the main series; unpublished rows have no link and are skipped.
 * Pages the index doesn't list (or the last one) get no button.
 *
 * Page shapes (see CLAUDE.md): skips the hub root, repo indexes, and pages that
 * pick their content by query string (thinker-arena's debate.html?d=<slug>),
 * where "the next file in the index" isn't the next piece of content.
 */
(function () {
  'use strict';

  var ID = 'bigcat-next';
  var parts = location.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return;                                   // hub root / repo root
  var file = parts[parts.length - 1];
  if (!/\.html$/i.test(file) || /^index(\.[a-z]+)?\.html$/i.test(file)) return;

  function isEnPage() {
    return (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
      || /\.en\.html$/i.test(location.pathname);
  }

  // The published series in index order: [{path, title}].
  var cache = {};
  function series(en) {
    var key = en ? 'en' : 'zh';
    if (cache[key]) return cache[key];
    var dir = '/' + parts.slice(0, -1).join('/') + '/';
    var indexUrl = location.origin + dir + (en ? 'index.en.html' : 'index.html');
    cache[key] = fetch(indexUrl, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var out = [], seen = {};
        doc.querySelectorAll('a.entry[href], .entry a[href]').forEach(function (a) {
          var u;
          try { u = new URL(a.getAttribute('href'), indexUrl); } catch (e) { return; }
          if (u.origin !== location.origin || u.pathname.indexOf(dir) !== 0) return;
          if (!/\.html$/.test(u.pathname) || /\/index(\.[a-z]+)?\.html$/.test(u.pathname)) return;
          if (en !== /\.en\.html$/.test(u.pathname)) return;
          if (seen[u.pathname]) return;
          seen[u.pathname] = 1;
          var t = a.querySelector('.title');
          out.push({ path: u.pathname, title: ((t || a).textContent || '').replace(/\s+/g, ' ').trim() });
        });
        return out;
      })
      .catch(function () { return []; });
    return cache[key];
  }

  // Sit right after the article: before the shared widgets that also mount at
  // the bottom (subscribe, AI disclaimer, comments) and before the footer.
  function mountPoint() {
    var sel = ['#bigcat-subscribe', '#ai-disclaimer', '#bigcat-comments', 'footer'];
    var first = null;
    sel.forEach(function (s) {
      var el = document.querySelector(s);
      if (!el) return;
      if (!first || (first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) first = el;
    });
    return first;
  }

  function render() {
    var old = document.getElementById(ID);
    if (old) old.remove();
    var picks = false;
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (!/^(me|ref|fbclid|gclid|utm_[a-z]+)$/i.test(k)) picks = true;
    });
    if (picks) return;                     // content chosen by query (debate.html?d=)
    var en = isEnPage();
    var here = location.pathname;
    return series(en).then(function (list) {
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].path === here) { i = k; break; }
      if (i < 0 || i >= list.length - 1) return;
      if (location.pathname !== here || document.getElementById(ID)) return;   // page swapped meanwhile
      var next = list[i + 1];

      var a = document.createElement('a');
      a.id = ID;
      a.href = next.path;
      a.style.cssText = [
        'display:block', 'max-width:760px', 'margin:40px auto 8px', 'padding:14px 18px',
        'border:1px solid currentColor', 'border-radius:12px', 'color:inherit',
        'text-decoration:none', 'opacity:.75', 'transition:opacity .2s',
        'box-sizing:border-box', 'line-height:1.55',
      ].join(';');
      var label = document.createElement('div');
      label.textContent = en ? 'Next →' : '下一篇 →';
      label.style.cssText = 'font-size:.78rem;letter-spacing:1px;opacity:.7;margin-bottom:3px;' +
        'font-family:"SF Mono",Menlo,monospace';
      var title = document.createElement('div');
      title.textContent = next.title;
      title.style.cssText = 'font-size:1rem;font-weight:600';
      a.appendChild(label);
      a.appendChild(title);
      a.addEventListener('mouseover', function () { a.style.opacity = 1; });
      a.addEventListener('mouseout', function () { a.style.opacity = .75; });

      var at = mountPoint();
      if (at && at.parentNode) at.parentNode.insertBefore(a, at);
      else (document.querySelector('.wrap, main, article') || document.body).appendChild(a);
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(render);
  // Audio auto-continue swaps the next article into this page without
  // navigating (i18n-tts.js); point the button at the one after that.
  window.addEventListener('bigcat:article-swap', render);
})();
