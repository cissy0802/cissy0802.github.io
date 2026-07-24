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
  var T = isEn
    ? { down: 'Offline', saved: 'Saved', saving: 'Saving', failed: 'Retry',
        confirm: 'Remove this page from offline storage?' }
    : { down: '离线', saved: '已离线', saving: '下载中', failed: '重试',
        confirm: '从离线存储中删除这一页？' };

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else { fn(); }
  }

  // Everything this page needs to work offline.
  function pageAssets() {
    var urls = [location.pathname];
    var lang = isEn ? 'en' : 'zh';
    var seen = {};
    document.querySelectorAll('[data-tts]').forEach(function (el) {
      var hash = el.getAttribute('data-tts');
      if (hash && !seen[hash]) {
        seen[hash] = 1;
        urls.push(new URL('audio/' + lang + '/' + hash + '.mp3', location.href).pathname);
      }
    });
    document.querySelectorAll('img[src]').forEach(function (img) {
      var u = new URL(img.getAttribute('src'), location.href);
      if (u.origin === location.origin) urls.push(u.pathname);
    });
    document.querySelectorAll('script[src]').forEach(function (s) {
      var u = new URL(s.getAttribute('src'), location.href);
      if (u.origin === location.origin) urls.push(u.pathname);
    });
    return urls;
  }

  function isLanding() {
    var p = location.pathname;
    return p === '/' || p === '/index.html' || p === '/index.en.html' || p === '/index.zh.html';
  }
  function landingLang() {
    return (/\/index\.en\.html$/.test(location.pathname) ||
            (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0) ? 'en' : 'zh';
  }

  ready(function () {
    var onArticle = !!document.querySelector('[data-tts]');
    var onLanding = isLanding();
    if (!onArticle && !onLanding) return;
    // Both the per-article button and the per-repo (landing) buttons are
    // owner-only. Resolve owner first (email cached, or backfilled once from a
    // session), then mount whichever this page is.
    function go() {
      if (!isOwnerNow()) return;
      if (onArticle) mountButton();
      if (onLanding) mountRepoButtons();
    }
    if (isOwnerNow()) { go(); return; }
    backfillEmail().then(go);
  });

  // ---- Whole-repo offline download (owner only, on the hub landing) --------

  // Collect every URL a fetched article needs offline (page + its baked audio +
  // same-origin images). Mirrors pageAssets() but reads a parsed document.
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

  function mountButton() {
    var btn = document.createElement('button');
    btn.id = 'offline-btn';
    btn.style.cssText =
      'position:fixed;bottom:18px;right:18px;z-index:9999;' +
      'padding:9px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.15);' +
      'background:rgba(30,30,50,.85);backdrop-filter:blur(10px);color:#e4e6eb;' +
      'font:600 13px -apple-system,sans-serif;cursor:pointer;';
    document.body.appendChild(btn);

    var state = 'idle';
    function render(extra) {
      btn.textContent =
        state === 'saved' ? '✓ ' + T.saved :
        state === 'saving' ? '⧖ ' + T.saving + (extra || '') :
        state === 'failed' ? '⚠ ' + T.failed :
        '⤓ ' + T.down;
      btn.style.color = state === 'saved' ? '#7ee2a8' : '#e4e6eb';
    }

    caches.open(CACHE).then(function (c) {
      return c.match(location.pathname);
    }).then(function (hit) {
      state = hit ? 'saved' : 'idle';
      render();
    });

    btn.addEventListener('click', function () {
      if (state === 'saving') return;

      if (state === 'saved') {
        if (!window.confirm(T.confirm)) return;
        caches.open(CACHE).then(function (c) {
          return Promise.all(pageAssets().map(function (u) { return c.delete(u); }));
        }).then(function () { state = 'idle'; render(); });
        return;
      }

      // Ask the browser not to evict our downloads under storage pressure.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

      var urls = pageAssets();
      var done = 0;
      state = 'saving';
      render(' 0/' + urls.length);

      caches.open(CACHE).then(function (c) {
        return Promise.all(urls.map(function (u) {
          return fetch(u, { cache: 'no-cache' }).then(function (res) {
            if (!res.ok) throw new Error(res.status + ' ' + u);
            return c.put(u, res);
          }).then(function () {
            done++;
            render(' ' + done + '/' + urls.length);
          });
        }));
      }).then(function () {
        state = 'saved'; render();
      }).catch(function (e) {
        console.warn('[offline] download failed:', e);
        state = 'failed'; render();
      });
    });
  }
})();
