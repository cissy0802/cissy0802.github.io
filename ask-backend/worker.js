/* bigcat-ask — question answering over the hub's own essays.
 *
 * The keyword side of search (Pagefind) answers "which pages contain 现象学".
 * This answers "哪几篇讲过决策疲劳" — questions whose words appear nowhere in the
 * text that should match. Retrieval runs on the bigcat-ask AI Search instance,
 * which indexes the clean Markdown corpus the nightly build writes to
 * bigcat-search/corpus/.
 *
 * Answers are grounded: the model only sees retrieved chunks, and every answer
 * ships the pages it drew from so a reader can check it. An answer with no
 * sources is a bug, not a fallback.
 *
 * Deploy from THIS directory, never the repo root:
 *   cd ask-backend && npx wrangler deploy
 */
'use strict';

const INSTANCE = 'bigcat-ask';
const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const SITE = 'https://hub.cissychen.com';
const MAX_QUERY = 300;

const ALLOWED_ORIGINS = new Set([
  'https://hub.cissychen.com',
  'https://cissy0802.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8001',
  'http://127.0.0.1:8001',
  'http://localhost:8231',
  'http://127.0.0.1:8231',
]);

const SYSTEM_PROMPT = `You answer questions about a personal learning hub of long-form essays on philosophy, science, mathematics, psychology and related subjects.

Rules:
- Answer ONLY from the provided context. If the context does not contain the answer, say so plainly — do not fill the gap from your own knowledge.
- Reply in the language the question is asked in. A Chinese question gets a Chinese answer, even when the sources are in English.
- Be concise: a short paragraph, or a few bullets when the question genuinely has several parts.
- Name the specific ideas and thinkers the essays discuss rather than speaking in generalities.
- Never mention file names, paths or the word "corpus". The reader sees articles, not storage. The interface lists the sources separately, so you do not need to enumerate them.
- Do not invent article titles or URLs.`;

function corsHeaders(req) {
  const origin = req.headers.get('Origin');
  const h = new Headers();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
  }
  h.set('Cache-Control', 'no-store');
  return h;
}

function json(req, status, body) {
  const h = corsHeaders(req);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}

/* corpus/philosophy/foo-day40.md      -> /philosophy/foo-day40.html
 * corpus/philosophy/foo-day40.en.md   -> /philosophy/foo-day40.en.html
 * corpus/thinker-arena/search/x.md    -> /thinker-arena/debate.html?id=x
 *   (debates render client-side; the corpus holds a crawlable snapshot, so the
 *    snapshot's own path would 404 — same rewrite search.js does for Pagefind.)
 */
function sourceUrl(key) {
  const path = String(key || '').replace(/^corpus\//, '').replace(/\.md$/, '');
  const debate = /^thinker-arena\/search\/(.+?)(\.en)?$/.exec(path);
  if (debate) return `${SITE}/thinker-arena/debate.html?id=${debate[1]}`;
  return `${SITE}/${path}.html`;
}

/* Article titles, keyed by corpus path. A retrieved chunk is a slice from the
 * middle of a page, so it almost never contains the page's own title — only the
 * first chunk carries the front matter. The nightly export writes this manifest
 * beside the corpus for exactly this. Held in module scope so a warm isolate
 * pays for it once.
 */
let titlesPromise = null;
function loadTitles(env) {
  titlesPromise =
    titlesPromise ||
    env.CORPUS.get('corpus/_titles.json')
      .then((o) => (o ? o.json() : {}))
      .catch(() => ({}));
  return titlesPromise;
}

/* One page can match on several chunks; a reader wants the page once, ranked by
 * its best chunk. The result shape here is what the API actually returns, which
 * is not what the docs describe: filename is top-level (not under metadata) and
 * content is an array of {type, text} parts rather than a string.
 */
function collapse(results, titles) {
  const byPage = new Map();
  for (const r of results || []) {
    const key = r.filename || (r.attributes && r.attributes.folder) || '';
    if (!key) continue;
    const path = key.replace(/^corpus\//, '').replace(/\.md$/, '');
    const known = titles[path];
    const url = (known && known.url) || sourceUrl(key);
    const prev = byPage.get(url);
    if (prev) {
      prev.chunks++;
      prev.score = Math.max(prev.score, Math.round(r.score * 1000) / 1000);
      continue;
    }
    byPage.set(url, {
      url,
      score: Math.round(r.score * 1000) / 1000,
      title: (known && known.title) || path.split('/').pop(),
      chunks: 1,
    });
  }
  return [...byPage.values()].sort((a, b) => b.score - a.score);
}

/* The model is told not to name files, and mostly obeys — but it can see the
 * filenames in its context and will sometimes cite one, e.g.
 * "《决策疲劳》（corpus/mental-models/energy-attention-day27.md）". Storage layout
 * is not something a reader should ever be shown, and a prompt is a request
 * rather than a guarantee, so strip it as well.
 */
function cleanAnswer(text) {
  return String(text || '')
    // Qwen3 is a hybrid reasoning model and can emit a think block, leaving
    // blank lines where one was.
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<\/think>/i, '')
    // A path in brackets, with the brackets: （corpus/a/b.md） or (corpus/a/b.md)
    .replace(/\s*[（(]\s*corpus\/[^)）]*?\.md\s*[)）]/gi, '')
    // ...or bare, mid-sentence.
    .replace(/\s*\bcorpus\/[^\s，。、）)]*\.md/gi, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      const h = corsHeaders(req);
      h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Content-Type');
      h.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers: h });
    }
    // Every request past here costs an embedding call, and answers cost
    // generation on top, so both are origin-gated. Not a security boundary —
    // Origin is trivially forged — but it keeps the bill tied to the site
    // rather than to whoever finds the URL. /debug is included deliberately: it
    // embeds the query too, so leaving it open would be an open tab on the bill.
    const origin = req.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return json(req, 403, { error: 'Not an allowed origin' });
    }

    // Retrieval without generation, for telling "the index has nothing" apart
    // from "the model had nothing to say". ?q= is required; threshold defaults
    // to 0 so it reports what the index actually holds.
    if (req.method === 'GET') {
      const u = new URL(req.url);
      if (u.pathname !== '/debug') return json(req, 404, { error: 'Not found' });
      const q = (u.searchParams.get('q') || '').trim().slice(0, MAX_QUERY);
      try {
        if (!q) return json(req, 200, { hint: 'pass ?q= to probe retrieval' });
        const res = await env.AI.autorag(INSTANCE).search({
          query: q,
          max_num_results: 5,
          ranking_options: { score_threshold: Number(u.searchParams.get('t')) || 0 },
        });
        return json(req, 200, {
          count: (res.data || []).length,
          hits: (res.data || []).map((r) => ({
            score: Math.round(r.score * 1000) / 1000,
            file: r.filename,
            head: (r.content || [])
              .map((c) => c.text || '')
              .join(' ')
              .slice(0, 100),
          })),
        });
      } catch (e) {
        return json(req, 502, { error: 'debug failed', detail: String((e && e.message) || e) });
      }
    }

    if (req.method !== 'POST') return json(req, 405, { error: 'Use POST' });

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(req, 400, { error: 'Expected a JSON body' });
    }
    const query = String((body && body.q) || '').trim().slice(0, MAX_QUERY);
    if (!query) return json(req, 400, { error: 'Empty query' });

    try {
      const res = await env.AI.autorag(INSTANCE).aiSearch({
        query,
        model: MODEL,
        system_prompt: SYSTEM_PROMPT,
        rewrite_query: false, // an English-leaning rewriter mangles Chinese terms
        max_num_results: 8,
        ranking_options: { score_threshold: Number(body.threshold) || 0.3 },
      });
      const sources = collapse(res.data, await loadTitles(env));
      return json(req, 200, {
        // Qwen3 is a hybrid reasoning model: it can emit a <think> block, and
        // leaves leading blank lines behind where one was. Neither belongs in
        // front of the reader.
        answer: cleanAnswer(res.response),
        sources,
        // Surfaced so a thin answer can be told apart from a thin retrieval.
        retrieved: (res.data || []).length,
      });
    } catch (e) {
      // Two separate throttles land here and neither is a breakage: Workers AI
      // 429s when the day's neuron allocation is spent ("10,000 neurons"), and
      // AI Search throttles bursts of its own ("Rate limited"). The UI tells the
      // reader to come back rather than that something is broken.
      const detail = String((e && e.message) || e);
      const quota = /429|neurons|allocation|rate limit/i.test(detail);
      return json(req, quota ? 429 : 502, {
        error: quota ? 'Quota exhausted' : 'Retrieval failed',
        detail,
      });
    }
  },
};
