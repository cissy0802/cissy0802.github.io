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

  ready(function () {
    // Only content pages with baked audio can be taken offline.
    if (!document.querySelector('[data-tts]')) return;
    if (document.getElementById('offline-btn')) return;
    // Owner already known (email cached) → mount now; otherwise try a one-time
    // backfill from an existing session and mount if it turns out to be them.
    if (isOwnerNow()) { mountButton(); return; }
    backfillEmail().then(function () {
      if (isOwnerNow() && !document.getElementById('offline-btn')) mountButton();
    });
  });

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
