/* BigCat Learning Hub — PWA offline support.
 *
 * Loaded on every page (content pages via index-button.js, hub indexes via
 * their own <script> tag). Does two things:
 *
 *   1. Registers the root service worker (/sw.js, scope "/") so the whole
 *      domain — hub + every content repo — works as one installable PWA.
 *   2. On content pages with baked TTS audio, injects a floating
 *      "download for offline" button that stores the page + its MP3s in the
 *      Cache API (cache "offline-content-v1", which sw.js serves from).
 *
 * Requires a secure context (https or localhost); silently no-ops otherwise.
 */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator) || !window.caches) return;

  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (e) {
    console.warn('[offline] SW registration failed:', e);
  });

  // The ⤓ download button is owner-only, tied to the owner's ACCOUNT: it shows
  // only when the logged-in account is the owner's. That makes it Just Work in
  // an installed PWA — log in once and it appears — with no ?me=1 (which iOS
  // strips on "Add to Home Screen") and no unlock gesture. SW registration and
  // offline *serving* stay on for everyone; this only gates the download UI.
  // To hand offline downloads to a different account, change OWNER_EMAIL.
  var OWNER_EMAIL = 'chengchen0802@gmail.com';
  var EMAIL_KEY = 'bigcat-email';     // cached by notes.js / account pages at login
  var SESSION_KEY = 'bigcat-session';
  var AUTH_API = 'https://bigcat-engage.cissychen.workers.dev';

  function cachedEmail() {
    try { return (localStorage.getItem(EMAIL_KEY) || '').toLowerCase(); } catch (e) { return ''; }
  }
  function isOwnerNow() { return cachedEmail() === OWNER_EMAIL; }

  // If a session exists but the email isn't cached yet (logged in before this
  // change, or a fresh device where notes.js hasn't resolved it), backfill it
  // once from the server so the button can appear without a manual reload.
  function backfillEmail() {
    var s;
    try { s = localStorage.getItem(SESSION_KEY); } catch (e) { s = null; }
    if (!s || cachedEmail()) return Promise.resolve(cachedEmail());
    return fetch(AUTH_API + '/auth-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: s })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.ok && res.email) {
        try { localStorage.setItem(EMAIL_KEY, res.email); } catch (e) {}
        return res.email.toLowerCase();
      }
      return '';
    }).catch(function () { return ''; });
  }

  var CACHE = 'offline-content-v1';
  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
    || /\.en\.html$/i.test(location.pathname);
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else { fn(); }
  }

  function isLanding() {
    var p = location.pathname;
    return p === '/' || p === '/index.html' || p === '/index.en.html' || p === '/index.zh.html';
  }
  function landingLang() {
    return (/\/index\.en\.html$/.test(location.pathname) ||
            (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0) ? 'en' : 'zh';
  }
  // A repo's category index: /{repo}/ or /{repo}/index(.en|.zh).html — one path
  // segment, and not the hub root (which isLanding handles).
  function isRepoIndex() {
    if (isLanding()) return false;
    return /^\/[^\/]+\/(index(\.en|\.zh)?\.html)?$/.test(location.pathname);
  }

  // Download buttons live on the *listing* pages, never floating over an
  // article (where they used to overlap the TTS bar): per-repo buttons on the
  // hub landing, per-article buttons on each repo's index. All owner-only.
  ready(function () {
    var onLanding = isLanding();
    var onRepoIndex = !onLanding && isRepoIndex();
    if (!onLanding && !onRepoIndex) return;
    function go() {
      if (!isOwnerNow()) return;
      if (onLanding) mountRepoButtons();
      if (onRepoIndex) mountEntryButtons();
    }
    if (isOwnerNow()) { go(); return; }
    backfillEmail().then(go);
  });

  // ---- Whole-repo offline download (owner only, on the hub landing) --------

  // Collect every URL a fetched article needs offline (page + its baked audio +
  // same-origin images), read from a parsed document.
  function assetsFromDoc(doc, pagePath) {
    var base = new URL(pagePath, location.origin);
    var lang = /\.en\.html$/.test(base.pathname) ? 'en' : 'zh';
    var urls = [base.pathname];
    var seen = {};
    doc.querySelectorAll('[data-tts]').forEach(function (el) {
      var h = el.getAttribute('data-tts');
      if (h && !seen[h]) { seen[h] = 1; urls.push(new URL('audio/' + lang + '/' + h + '.mp3', base).pathname); }
    });
    doc.querySelectorAll('img[src]').forEach(function (img) {
      var u = new URL(img.getAttribute('src'), base);
      if (u.origin === location.origin) urls.push(u.pathname);
    });
    return urls;
  }

  // A repo's category index is the authoritative list of its articles. Pull the
  // article pages in the landing's language (skip index/nav pages).
  function repoArticlePages(repo, lang) {
    var idxPath = repo + (lang === 'en' ? 'index.en.html' : 'index.html');
    return fetch(idxPath, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('index ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var pages = {};
      doc.querySelectorAll('a[href]').forEach(function (a) {
        var u;
        try { u = new URL(a.getAttribute('href'), location.origin + idxPath); } catch (e) { return; }
        if (u.origin !== location.origin) return;
        if (u.pathname.indexOf(repo) !== 0) return;          // stay inside this repo
        if (!/\.html$/.test(u.pathname)) return;
        if (/\/index(\.\w+)?\.html$/.test(u.pathname)) return; // skip index/nav
        var isEnPage = /\.en\.html$/.test(u.pathname);
        if (lang === 'en' ? !isEnPage : isEnPage) return;    // match landing language
        pages[u.pathname] = 1;
      });
      return Object.keys(pages);
    });
  }

  // Download every article in a repo, one at a time (assets within an article
  // fetched in parallel). onProgress(done, total) drives the button label.
  function downloadRepo(repo, lang, onProgress) {
    return repoArticlePages(repo, lang).then(function (pages) {
      var total = pages.length, done = 0, failed = 0;
      if (!total) return { total: 0, done: 0, failed: 0 };
      return caches.open(CACHE).then(function (c) {
        return pages.reduce(function (chain, page) {
          return chain.then(function () {
            return fetch(page, { cache: 'no-cache' }).then(function (r) {
              if (!r.ok) throw new Error(page + ' ' + r.status);
              return r.text();
            }).then(function (html) {
              var doc = new DOMParser().parseFromString(html, 'text/html');
              return Promise.all(assetsFromDoc(doc, page).map(function (u) {
                return fetch(u, { cache: 'no-cache' }).then(function (res) {
                  if (res.ok) return c.put(u, res);
                }).catch(function () {});
              }));
            }).catch(function () { failed++; }).then(function () {
              done++; if (onProgress) onProgress(done, total);
            });
          });
        }, Promise.resolve()).then(function () { return { total: total, done: done, failed: failed }; });
      });
    });
  }

  function mountRepoButtons() {
    if (document.querySelector('.repo-dl')) return;
    var lang = landingLang();
    var confirmMsg = lang === 'en'
      ? 'Download this whole site (all articles + audio) for offline? It may be large.'
      : '整仓离线下载（全部文章 + 语音）？可能有几百 MB。';
    document.querySelectorAll('a.card[href]').forEach(function (card) {
      var m;
      try { m = /^\/([^\/]+)\//.exec(new URL(card.getAttribute('href'), location.origin).pathname); }
      catch (e) { return; }
      if (!m) return;
      var repo = '/' + m[1] + '/';

      var btn = document.createElement('button');
      btn.className = 'repo-dl';
      btn.type = 'button';
      btn.title = lang === 'en' ? 'Download whole site offline' : '整仓离线下载';
      btn.textContent = '⤓';
      btn.style.cssText =
        'position:absolute;right:8px;bottom:6px;z-index:5;min-width:26px;height:26px;' +
        'padding:0 7px;border-radius:13px;border:1px solid rgba(255,255,255,.2);' +
        'background:rgba(20,20,40,.72);color:#a0a8c0;font:600 13px -apple-system,sans-serif;' +
        'cursor:pointer;line-height:24px;';
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

      var state = 'idle';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (state === 'running' || state === 'done') return;
        if (!window.confirm(confirmMsg)) return;
        state = 'running';
        btn.style.fontSize = '10px';
        btn.textContent = '…';
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        downloadRepo(repo, lang, function (d, t) { btn.textContent = d + '/' + t; })
          .then(function (res) {
            state = 'done';
            btn.style.fontSize = '13px';
            btn.textContent = res.total ? '✓' : '∅';
            btn.style.color = res.total ? '#7ee2a8' : '#a0a8c0';
          })
          .catch(function (err) {
            console.warn('[offline] repo download failed:', err);
            state = 'idle';
            btn.style.fontSize = '13px';
            btn.textContent = '⚠';
            btn.style.color = '#ff9b9b';
          });
      });
      card.appendChild(btn);
    });
  }

  // ---- Per-article download on a repo's index (owner only) ----------------

  // Fetch one article and cache it + its baked audio + images.
  function downloadArticle(path) {
    return caches.open(CACHE).then(function (c) {
      return fetch(path, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(path + ' ' + r.status);
        return r.text();
      }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        return Promise.all(assetsFromDoc(doc, path).map(function (u) {
          return fetch(u, { cache: 'no-cache' }).then(function (res) {
            if (res.ok) return c.put(u, res);
          }).catch(function () {});
        }));
      });
    });
  }

  function mountEntryButtons() {
    if (document.querySelector('.entry-dl')) return;
    caches.open(CACHE).then(function (c) {
      document.querySelectorAll('a.entry[href]').forEach(function (entry) {
        var u;
        try { u = new URL(entry.getAttribute('href'), location.href); } catch (e) { return; }
        if (u.origin !== location.origin || !/\.html$/.test(u.pathname)) return;
        if (/\/index(\.\w+)?\.html$/.test(u.pathname)) return;
        var page = u.pathname;

        var btn = document.createElement('button');
        btn.className = 'entry-dl';
        btn.type = 'button';
        btn.title = isEn ? 'Save offline' : '离线下载';
        btn.textContent = '⤓';
        btn.style.cssText =
          'position:absolute;right:12px;top:50%;transform:translateY(-50%);z-index:5;' +
          'min-width:28px;height:28px;padding:0 8px;border-radius:14px;' +
          'border:1px solid rgba(123,97,255,.4);background:rgba(123,97,255,.12);' +
          'color:#7b61ff;font:600 14px -apple-system,sans-serif;cursor:pointer;line-height:26px;';
        if (getComputedStyle(entry).position === 'static') entry.style.position = 'relative';
        // Reserve room on the right so the button never overlaps the entry text
        // (models are right-aligned on desktop, stacked on mobile).
        entry.style.paddingRight = '56px';

        // Show ✓ if this article is already cached.
        c.match(page).then(function (hit) { if (hit) { btn.textContent = '✓'; btn.dataset.done = '1'; } });

        var busy = false;
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (busy || btn.dataset.done) return;
          busy = true;
          btn.style.fontSize = '10px';
          btn.textContent = '…';
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
          downloadArticle(page).then(function () {
            btn.dataset.done = '1';
            btn.style.fontSize = '14px';
            btn.textContent = '✓';
            btn.style.color = '#7ee2a8';
            btn.style.borderColor = 'rgba(126,226,168,.5)';
          }).catch(function (err) {
            console.warn('[offline] article download failed:', err);
            btn.style.fontSize = '14px';
            btn.textContent = '⚠';
            btn.style.color = '#ff9b9b';
          }).then(function () { busy = false; });
        });
        entry.appendChild(btn);
      });
    });
  }
})();
