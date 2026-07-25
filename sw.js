/* BigCat Learning Hub — service worker
 *
 * Registered at the origin root, so its scope covers the hub index AND every
 * content repo published under this domain (/mental-models/..., /ai-ml/..., ...).
 *
 * Caches:
 *   shell-v1            hub index pages + root scripts, refreshed on SW update
 *   offline-content-v1  pages + MP3s the user explicitly downloaded (offline.js
 *                       writes here via the Cache API; the SW only reads it)
 *   runtime-v1          small same-origin assets (js/css/img), stale-while-revalidate
 *
 * MP3s are never auto-cached (too big) — they are served from offline-content-v1
 * when present, straight from the network otherwise.
 */
'use strict';

const SHELL = 'shell-v1';
const CONTENT = 'offline-content-v1';
const RUNTIME = 'runtime-v1';

// Repos whose audio/ moved to R2 serve MP3s from here instead of same-origin.
// Without this exemption the fetch handler bails out on the cross-origin
// request and a downloaded article plays nothing offline.
// Mirrors R2_AUDIO_ORIGIN in i18n-tts.js and offline.js.
const AUDIO_ORIGIN = 'https://bigcat-audio.cissychen.workers.dev';

const SHELL_URLS = [
  '/',
  '/index.en.html',
  '/index.zh.html',
  '/offline.js',
  '/i18n-tts.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  const keep = new Set([SHELL, CONTENT, RUNTIME]);
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      // Downloading a page for offline also stored its <script> tags, so an old
      // copy of a shared script can sit in the content cache long after the
      // origin has a newer one. Scripts are re-fetched from the network anyway
      // (see the JS/CSS rule below), so drop them here — otherwise a device
      // that had downloaded articles keeps running yesterday's code offline.
      .then(() => caches.open(CONTENT))
      .then((c) =>
        c.keys().then((reqs) =>
          Promise.all(
            reqs
              .filter((r) => /\.(js|css)$/.test(new URL(r.url).pathname))
              .map((r) => c.delete(r))
          )
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.origin !== AUDIO_ORIGIN) return;

  // Audio: downloaded copy first, network otherwise. No implicit caching.
  // Match ignoring Range/Vary so a seek inside a segment still hits the
  // downloaded copy instead of falling through to the network.
  if (url.pathname.endsWith('.mp3')) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true, ignoreVary: true })
        .then((hit) => hit || fetch(req))
    );
    return;
  }
  if (!sameOrigin) return;   // the audio origin serves nothing else

  // Page navigations: freshest wins, cached copy when offline.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Keep the shell copies of the hub indexes fresh as a side effect.
          if (SHELL_URLS.includes(url.pathname) && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/index.en.html').then((idx) =>
            idx || new Response('<h1>Offline</h1><p>This page has not been downloaded.</p>',
              { status: 503, headers: { 'Content-Type': 'text/html' } })
          ))
        )
    );
    return;
  }

  // JS/CSS: network-first. A stale-while-revalidate here would let copies in
  // offline-content-v1 (downloaded pages include their scripts) permanently
  // shadow updated versions, since revalidation writes to RUNTIME only.
  if (/\.(js|css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else small (img/json/fonts): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
