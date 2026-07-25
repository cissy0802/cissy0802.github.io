/* bigcat-search — serves the Pagefind index out of R2.
 *
 * Why this exists: the index is ~3100 files / 46MB, rebuilt every night. Kept
 * in the repo it was committed daily as binary, and had already pushed .git
 * past 700MB. R2 holds it instead; nothing search-related is in git any more.
 *
 * Why a Worker instead of an R2 custom domain: same reason as bigcat-audio —
 * cissychen.com's DNS is on Route 53, so r2.dev would be the only alternative
 * and Cloudflare rate-limits it. A Worker also lets us set CORS and per-file
 * cache policy, both of which Pagefind needs.
 *
 * URL shape mirrors the old same-origin layout exactly, so the client only
 * swaps an origin:
 *   /pagefind/pagefind-entry.json
 *   /pagefind/pagefind.<lang>_<hash>.pf_meta
 *   /pagefind/index/<hash>.pf_index
 *   /pagefind/fragment/<hash>.pf_fragment
 *   /pagefind/wasm.<lang>.pagefind        (and the .js/.css UI bundle)
 *
 * Cross-origin caveat: pagefind.js tries `new Worker(basePath +
 * "pagefind-worker.js")`, which a cross-origin URL makes throw. Pagefind
 * catches it and falls back to searching on the main thread — measured at
 * ~15ms per query on this index, so the fallback is not worth avoiding.
 *
 * Deploy from THIS directory, never the repo root:
 *   cd search-backend && npx wrangler deploy
 */
'use strict';

const ALLOWED_ORIGINS = new Set([
  'https://hub.cissychen.com',
  'https://cissy0802.github.io',
  // local staging of the hub
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8001',
  'http://127.0.0.1:8001',
  'http://localhost:8231',
  'http://127.0.0.1:8231',
]);

// /pagefind/<file> or /pagefind/<fragment|index|filter>/<file>. Anchored, and
// no dots-only segments, so a request can't walk out of the prefix.
const KEY_RE = /^\/pagefind\/(?:(fragment|index|filter)\/)?([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

const TYPES = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

// Everything whose name carries a content hash never changes behind that name.
// pagefind-entry.json is the pointer to the current build's hashed files, so it
// is the one file that must not be cached hard — it's how a rebuild lands.
function cacheControl(path) {
  if (/\/(fragment|index|filter)\//.test(path)) return 'public, max-age=31536000, immutable';
  if (/\.pf_meta$/.test(path)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=300';
}

function contentType(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
}

function corsHeaders(req) {
  const origin = req.headers.get('Origin');
  const h = new Headers();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Expose-Headers', 'Content-Length, ETag');
  }
  return h;
}

function deny(req, status, msg) {
  const h = corsHeaders(req);
  h.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(msg + '\n', { status, headers: h });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') {
      const h = corsHeaders(req);
      h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Range, If-None-Match');
      h.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers: h });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return deny(req, 405, 'Method not allowed');
    }

    const url = new URL(req.url);
    if (!KEY_RE.test(url.pathname)) return deny(req, 404, 'Not found');
    const key = url.pathname.slice(1); // bucket keys mirror the URL path

    const cache = caches.default;
    if (req.method === 'GET') {
      const hit = await cache.match(req);
      if (hit) {
        const h = new Headers(hit.headers);
        for (const [k, v] of corsHeaders(req)) h.set(k, v);
        return new Response(hit.body, { status: hit.status, headers: h });
      }
    }

    const obj = await env.SEARCH.get(key, { onlyIf: req.headers });
    if (!obj) return deny(req, 404, 'Not found');

    const h = corsHeaders(req);
    obj.writeHttpMetadata(h);
    h.set('ETag', obj.httpEtag);
    h.set('Content-Type', contentType(url.pathname));
    h.set('Cache-Control', cacheControl(url.pathname));

    // onlyIf failed → R2 returns metadata with no body.
    if (!obj.body) {
      const inm = req.headers.get('If-None-Match');
      const fresh = inm && (inm === '*' || inm.split(',').some((t) => t.trim() === obj.httpEtag));
      return new Response(null, { status: fresh ? 304 : 412, headers: h });
    }

    const res = new Response(req.method === 'HEAD' ? null : obj.body, { status: 200, headers: h });
    if (req.method === 'GET') ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  },
};
