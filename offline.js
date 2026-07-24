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

  // The ⤓ download button is owner-only: visit any page once with ?me=1 to
  // enable it on this device (?me=0 disables). localStorage is per-origin, so
  // one visit unlocks every content repo on the domain. SW registration and
  // offline *serving* stay on for everyone — this only gates the download UI.
  var OWNER_KEY = 'bigcat-offline-owner';
  var me = /[?&]me=([01])/.exec(location.search);
  if (me) {
    try {
      if (me[1] === '1') localStorage.setItem(OWNER_KEY, '1');
      else localStorage.removeItem(OWNER_KEY);
    } catch (e) {}
  }
  var isOwner = false;
  try { isOwner = localStorage.getItem(OWNER_KEY) === '1'; } catch (e) {}

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
    // Only the owner's devices get the button (see OWNER_KEY above), and only
    // on content pages with baked audio.
    if (!isOwner) return;
    if (!document.querySelector('[data-tts]')) return;

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
  });
})();
