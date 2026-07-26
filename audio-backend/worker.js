/* bigcat-audio — serves baked TTS MP3s out of R2.
 *
 * Why a Worker instead of an R2 custom domain: cissychen.com's DNS lives on
 * Route 53, not Cloudflare, so r2.dev is the only alternative — and Cloudflare
 * rate-limits r2.dev and tells you not to use it in production. A Worker on
 * workers.dev needs no DNS change and lets us set CORS + cache headers, which
 * the PWA requires (an opaque cross-origin response cannot be cache.put()).
 *
 * URL shape:  /<repo>/<one to three slug segments>/<sha1-16>.mp3
 * e.g.        /personal-finance/zh/6b1e3a0f9c2d4e77.mp3
 *             /thinker-arena/debate/acceptable-inequality/2ede2d003c11e8ce.mp3
 *
 * The middle is the repo's own path under audio/, kept verbatim. Most repos
 * split by language; thinker-arena splits per debate because each one bakes a
 * different voice per speaker.
 *
 * Keys are content-addressed (sha1 of the narration text, plus voice and pitch
 * where those vary), so a given URL's bytes never change — everything is
 * immutable and cached hard.
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

// /<repo>/<segment>[/<segment>[/<segment>]]/<hash>.mp3 — anchored, and each
// segment is a bare slug, so a dot (and therefore "..") can never appear in a
// key and a request can't walk out of the bucket layout or probe other objects.
const KEY_RE = /^\/([a-z0-9][a-z0-9-]{0,48})\/((?:[a-z0-9][a-z0-9-]{0,63}\/){1,3})([0-9a-f]{16})\.mp3$/;

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
  // Never let a failure be cached. An earlier version answered 412 while still
  // carrying the success path's immutable max-age, so a browser could hold onto
  // the error for a year after the bug behind it was fixed.
  h.set('Cache-Control', 'no-store');
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
    // m[2] already carries its trailing slash, however many segments deep.
    const key = `${m[1]}/${m[2]}${m[3]}.mp3`;

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

    // Deliberately no `onlyIf: req.headers`. That hands R2 every conditional
    // header the browser sent, and a browser revalidating a cached MP3 sends
    // If-Modified-Since, not If-None-Match — R2 then answers "not modified" by
    // returning the object with a null body, which is impossible to tell apart
    // from a real precondition failure. Answering 412 to that broke playback for
    // exactly the clients that had heard the file before, while plain curl,
    // which sends no validators, worked fine. Range still goes to R2: that is a
    // byte selector, not a precondition, and it is what makes seeking work.
    const obj = await env.AUDIO.get(key, {
      range: range ? req.headers : undefined,
    });
    if (!obj) return deny(req, 404, 'Not found');

    const h = corsHeaders(req);
    obj.writeHttpMetadata(h);
    h.set('ETag', obj.httpEtag);
    h.set('Content-Type', 'audio/mpeg');
    h.set('Accept-Ranges', 'bytes');
    // Content-addressed: the bytes behind a URL never change.
    h.set('Cache-Control', 'public, max-age=31536000, immutable');

    // Revalidation, handled here rather than by R2 so only ETag can ever cause a
    // bodyless answer. Anything else (If-Modified-Since, If-Match and friends)
    // just gets the audio — a wasted read beats a wrong 412.
    const inm = req.headers.get('If-None-Match');
    if (inm && (inm === '*' || inm.split(',').some((t) => t.trim() === obj.httpEtag))) {
      return new Response(null, { status: 304, headers: h });
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
