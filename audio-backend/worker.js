/* bigcat-audio — serves baked TTS MP3s out of R2.
 *
 * Why a Worker instead of an R2 custom domain: cissychen.com's DNS lives on
 * Route 53, not Cloudflare, so r2.dev is the only alternative — and Cloudflare
 * rate-limits r2.dev and tells you not to use it in production. A Worker on
 * workers.dev needs no DNS change and lets us set CORS + cache headers, which
 * the PWA requires (an opaque cross-origin response cannot be cache.put()).
 *
 * URL shape:  /<repo>/<lang>/<sha1-16>.mp3
 * e.g.        /personal-finance/zh/6b1e3a0f9c2d4e77.mp3
 *
 * Keys are content-addressed (sha1 of the narration text), so a given URL's
 * bytes never change — everything is immutable and cached hard.
 *
 * Deploy from THIS directory, never the repo root:
 *   cd audio-backend && npx wrangler deploy
 */
'use strict';

const ALLOWED_ORIGINS = new Set([
  'https://hub.cissychen.com',
  'https://cissy0802.github.io',
  // local `python3 -m http.server` staging of the hub
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8001',
  'http://127.0.0.1:8001',
]);

// /<repo>/<lang>/<hash>.mp3 — anchored so a request can't walk out of the
// bucket layout or probe for other objects.
const KEY_RE = /^\/([a-z0-9][a-z0-9-]{0,48})\/(zh|en)\/([0-9a-f]{16})\.mp3$/;

function corsHeaders(req) {
  const origin = req.headers.get('Origin');
  const h = new Headers();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag');
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
      h.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers: h });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return deny(req, 405, 'Method not allowed');
    }

    const url = new URL(req.url);
    const m = KEY_RE.exec(url.pathname);
    if (!m) return deny(req, 404, 'Not found');
    const key = `${m[1]}/${m[2]}/${m[3]}.mp3`;

    const range = req.headers.get('Range');
    const cache = caches.default;

    // Only whole-file GETs go through the edge cache; ranged reads are cheap
    // enough against R2 and caching them correctly is more trouble than it's
    // worth (each distinct Range would need its own entry).
    if (!range && req.method === 'GET') {
      const hit = await cache.match(req);
      if (hit) {
        const h = new Headers(hit.headers);
        for (const [k, v] of corsHeaders(req)) h.set(k, v);
        return new Response(hit.body, { status: hit.status, headers: h });
      }
    }

    const obj = await env.AUDIO.get(key, {
      range: range ? req.headers : undefined,
      onlyIf: req.headers,
    });
    if (!obj) return deny(req, 404, 'Not found');

    const h = corsHeaders(req);
    obj.writeHttpMetadata(h);
    h.set('ETag', obj.httpEtag);
    h.set('Content-Type', 'audio/mpeg');
    h.set('Accept-Ranges', 'bytes');
    // Content-addressed: the bytes behind a URL never change.
    h.set('Cache-Control', 'public, max-age=31536000, immutable');

    // onlyIf failed → R2 hands back metadata with no body. A stale-validator
    // miss on If-None-Match is a 304; anything else (If-Match, If-Unmodified-
    // Since) is a precondition failure.
    if (!obj.body) {
      const inm = req.headers.get('If-None-Match');
      const fresh = inm && (inm === '*' || inm.split(',').some((t) => t.trim() === obj.httpEtag));
      return new Response(null, { status: fresh ? 304 : 412, headers: h });
    }

    // Base the status on what the CLIENT asked for: R2 reports a range on the
    // object even when none was requested (offset 0, full length), so trusting
    // obj.range alone answers every plain GET with a bogus 206.
    let status = 200;
    if (range && obj.range && typeof obj.range.offset === 'number'
        && typeof obj.range.length === 'number') {
      const start = obj.range.offset;
      const end = start + obj.range.length - 1;
      h.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
      h.set('Content-Length', String(obj.range.length));
      status = 206;
    }

    const res = new Response(req.method === 'HEAD' ? null : obj.body, { status, headers: h });
    if (status === 200 && req.method === 'GET') {
      ctx.waitUntil(cache.put(req, res.clone()));
    }
    return res;
  },
};
