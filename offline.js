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

  // Baked MP3s: relative to the page for most repos, R2 (via the bigcat-audio
  // Worker) for migrated ones. Mirror of the block in i18n-tts.js — keep the
  // two lists and sw.js's AUDIO_ORIGIN in sync when migrating a repo.
  var R2_AUDIO_ORIGIN = 'https://bigcat-audio.cissychen.workers.dev';
  var R2_AUDIO_REPOS = {
    'ai-ml': 1,
    'art-aesthetics': 1,
    'biographies': 1,
    'book-recommendations': 1,
    'buddhism': 1,
    'chapter-deepread': 1,
    'civics-geopolitics': 1,
    'complexity-science': 1,
    'cs-papers-deepread': 1,
    'deep-reading': 1,
    'deep-research': 1,
    'family-craft': 1,
    'health-longevity': 1,
    'history': 1,
    'investing': 1,
    'leadership': 1,
    'mathematics': 1,
    'mental-models': 1,
    'meta-knowledge': 1,
    'neuroscience': 1,
    'novel-deepread': 1,
    'parenting': 1,
    'personal-finance': 1,
    'philosophy': 1,
    'physics': 1,
    'psychology': 1,
    'sales': 1,
    'super-individual': 1,
    'synthesis': 1,
    'system-design': 1,
    'world-religions': 1,
    'writing': 1,
  };

  function repoSlugOf(pathname) {
    var m = /^\/([^/]+)\//.exec(pathname);
    return m ? m[1] : '';
  }

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
  // Synthetic cache keys recording "this whole repo was downloaded".
  var REPO_MARK = '/__bigcat-downloaded/';
  // Written while a whole-repo download is running. Leaving the page unloads
  // the script mid-flight, so this is what tells a later visit that a download
  // was interrupted and should pick up where it stopped.
  var REPO_BUSY = '/__bigcat-downloading/';
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
      if (onRepoIndex) {
        mountEntryButtons();
        // thinker-arena builds its debate list from JSON after this runs, so
        // the first pass finds nothing. Retry while the list is still growing.
        var seen = -1, tries = 0;
        var settle = setInterval(function () {
          var n = document.querySelectorAll(ENTRY_SEL).length;
          if (n !== seen) { seen = n; mountEntryButtons(); }
          if (++tries >= 8) clearInterval(settle);
        }, 500);
      }
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
    // Key the page by the URL that selects its content, so debate.html?d=a
    // and ?d=b are separate entries rather than one shared shell.
    var urls = [base.pathname + (base.search || '')];
    var seen = {};
    // Migrated repos yield an absolute cross-origin URL here. fetch() and
    // cache.put() take either shape, and sw.js matches on the full URL.
    var repo = repoSlugOf(base.pathname);
    doc.querySelectorAll('[data-tts]').forEach(function (el) {
      var h = el.getAttribute('data-tts');
      if (!h || seen[h]) return;
      seen[h] = 1;
      urls.push(R2_AUDIO_REPOS[repo]
        ? R2_AUDIO_ORIGIN + '/' + repo + '/' + lang + '/' + h + '.mp3'
        : new URL('audio/' + lang + '/' + h + '.mp3', base).pathname);
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
    var slug = repo.replace(/\//g, '');
    return repoArticlePages(repo, lang).then(function (pages) {
      // Cache the index itself too — offline it's the way back into the site,
      // and without it a downloaded repo has no navigable entry point.
      var idxPath = repo + (lang === 'en' ? 'index.en.html' : 'index.html');
      caches.open(CACHE).then(function (c) {
        fetch(idxPath, { cache: 'no-cache' }).then(function (r) {
          if (r.ok) c.put(idxPath, r);
        }).catch(function () {});
      });
      var total = pages.length, done = 0, failed = 0;
      if (!total) return { total: 0, done: 0, failed: 0 };
      return caches.open(CACHE).then(function (c) {
        // Mark the run so an interrupted download can be resumed later.
        c.put(REPO_BUSY + slug, new Response(JSON.stringify({ lang: lang, ts: Date.now() }),
          { headers: { 'Content-Type': 'application/json' } })).catch(function () {});
        return pages.reduce(function (chain, page) {
          return chain.then(function () {
            // Already downloaded (an earlier, interrupted run) — count it and
            // move on, so resuming costs nothing for what's already there.
            return c.match(page).then(function (hit) {
              if (!hit) return null;
              done++;
              if (onProgress) onProgress(done, total);
              return 'skip';
            });
          }).then(function (skip) {
            if (skip === 'skip') return;
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
        }, Promise.resolve()).then(function () {
          c.delete(REPO_BUSY + slug).catch(function () {});
          // Leave a marker in the cache so a later page load knows this repo
          // was taken whole — without it the button always came back as ⤓.
          return c.put(REPO_MARK + slug,
            new Response(JSON.stringify({ total: total, done: done, failed: failed, ts: Date.now() }),
              { headers: { 'Content-Type': 'application/json' } }))
            .catch(function () {})
            .then(function () { return { total: total, done: done, failed: failed }; });
        });
      });
    });
  }

  // What the cache already holds, per repo: whether it was taken whole, and
  // how many of its pages are present. One scan for the whole landing.
  function cachedRepoState() {
    return caches.open(CACHE).then(function (c) {
      return c.keys().then(function (reqs) {
        var state = {};
        reqs.forEach(function (r) {
          var p;
          try { p = new URL(r.url).pathname; } catch (e) { return; }
          if (p.indexOf(REPO_MARK) === 0) {
            var slug = p.slice(REPO_MARK.length);
            var st = (state[slug] = state[slug] || { pages: 0 });
            st.whole = true;
            st.markReq = r;   // body carries the page count of that run
            return;
          }
          if (p.indexOf(REPO_BUSY) === 0) {
            var bslug = p.slice(REPO_BUSY.length);
            (state[bslug] = state[bslug] || { pages: 0 }).interrupted = true;
            return;
          }
          if (!/\.html$/.test(p)) return;
          if (/\/index(\.\w+)?\.html$/.test(p)) return;
          var m = /^\/([^\/]+)\//.exec(p);
          if (!m) return;
          (state[m[1]] = state[m[1]] || { pages: 0 }).pages++;
        });
        // A completion marker only says "a full run finished once". If pages
        // have been deleted since — or the run is being compared against a
        // site that has grown — the tick would be a lie, so check the count
        // the run recorded against what is actually still cached.
        var slugs = Object.keys(state).filter(function (k) { return state[k].markReq; });
        return Promise.all(slugs.map(function (k) {
          return c.match(state[k].markReq).then(function (res) {
            return res ? res.json() : null;
          }).then(function (j) {
            state[k].total = (j && j.total) || 0;
            delete state[k].markReq;
          }).catch(function () { delete state[k].markReq; });
        })).then(function () { return state; });
      });
    }).catch(function () { return {}; });
  }

  // Two separate controls per site, never one button that changes meaning:
  // ⤓ downloads (or resumes, showing how many pages are in), 🗑 removes what's
  // stored. The bin only appears once there is something to remove.
  function mountRepoButtons() {
    if (document.querySelector('.repo-dl')) return;
    var lang = landingLang();
    var T = lang === 'en'
      ? { ask: 'Download this whole site (all articles + audio) for offline? It may be large.',
          dl: 'Download whole site offline',
          up: function (n) { return n + ' saved (not the whole site) — tap to download it all'; },
          done: function (n) { return 'Whole site downloaded (' + n + ') — tap to fetch anything new'; },
          rm: 'Delete downloaded content', rmAsk: 'Remove everything downloaded from this site?' }
      : { ask: '整仓离线下载（全部文章 + 语音）？可能有几百 MB。',
          dl: '整仓离线下载',
          up: function (n) { return '已存 ' + n + ' 篇（未整仓）— 点击下载整仓'; },
          done: function (n) { return '整仓已下载（' + n + ' 篇）— 点击可补下新增内容'; },
          rm: '删除已下载内容', rmAsk: '删除这个站已下载的全部内容？' };
    var stateReady = cachedRepoState();

    document.querySelectorAll('a.card[href]').forEach(function (card) {
      var m;
      try { m = /^\/([^\/]+)\//.exec(new URL(card.getAttribute('href'), location.origin).pathname); }
      catch (e) { return; }
      if (!m) return;
      var slug = m[1];
      var repo = '/' + slug + '/';

      var bar = document.createElement('span');
      bar.className = 'repo-dl';
      bar.style.cssText =
        'position:absolute;right:8px;bottom:6px;z-index:5;display:flex;gap:5px;align-items:center;';
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

      function mk(text, title) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.style.cssText =
          'min-width:26px;height:26px;padding:0 7px;border-radius:13px;' +
          'border:1px solid rgba(255,255,255,.2);background:rgba(20,20,40,.72);' +
          'color:#a0a8c0;font:600 13px -apple-system,sans-serif;cursor:pointer;line-height:24px;';
        b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
        return b;
      }
      var dl = mk('⤓', T.dl);
      var rm = mk('🗑', T.rm);
      rm.style.display = 'none';          // nothing stored yet
      rm.style.fontSize = '11px';
      bar.appendChild(dl);
      bar.appendChild(rm);
      card.appendChild(bar);

      var state = 'idle';

      function showIdle() {
        state = 'idle';
        dl.style.fontSize = '13px';
        dl.textContent = '⤓';
        dl.style.color = '#a0a8c0';
        dl.title = T.dl;
        rm.style.display = 'none';
      }
      function showPartial(n) {
        state = 'idle';
        dl.style.fontSize = '11px';
        dl.textContent = String(n);
        dl.style.color = '#a0a8c0';
        dl.title = T.up(n);
        rm.style.display = '';
      }
      function showDone(n) {
        state = 'done';
        dl.style.fontSize = '13px';
        dl.textContent = '✓';
        dl.style.color = '#7ee2a8';
        dl.title = T.done(n || '');
        rm.style.display = '';
      }

      function startDownload(skipConfirm) {
        if (state === 'running') return;
        if (!skipConfirm && !window.confirm(T.ask)) return;
        state = 'running';
        dl.style.fontSize = '10px';
        dl.textContent = '…';
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        downloadRepo(repo, lang, function (d, t) { dl.textContent = d + '/' + t; })
          .then(function (res) {
            if (res.total) showDone(res.total);
            else { showIdle(); dl.textContent = '∅'; }
          })
          .catch(function (err) {
            console.warn('[offline] repo download failed:', err);
            state = 'idle';
            dl.style.fontSize = '13px';
            dl.textContent = '⚠';
            dl.style.color = '#ff9b9b';
          });
      }

      dl.addEventListener('click', function () { startDownload(state === 'done'); });
      rm.addEventListener('click', function () {
        if (state === 'running') return;
        if (!window.confirm(T.rmAsk)) return;
        state = 'running';
        dl.textContent = '…';
        removeRepo(slug).then(showIdle);
      });

      // Restore what this device already holds.
      stateReady.then(function (cached) {
        var st = cached[slug];
        if (!st) return;
        // Tick only if the pages that run stored are still present; otherwise
        // it's no longer a whole copy and the count is the honest signal.
        if (st.whole && st.pages >= (st.total || 0)) showDone(st.pages);
        else if (st.interrupted) {
          // Cut off by navigating away — pick it up without asking again.
          if (st.pages) showPartial(st.pages);
          startDownload(true);
        } else if (st.pages) showPartial(st.pages);
      });
    });
  }

  // ---- Per-article download on a repo's index (owner only) ----------------

  // A debate page is a shell: its text lives in JSON fetched at runtime, so
  // caching the HTML alone leaves it blank offline.
  function debateExtras(path) {
    var u;
    try { u = new URL(path, location.origin); } catch (e) { return []; }
    if (!/\/thinker-arena\/debate(\.en)?\.html$/.test(u.pathname)) return [];
    var id = new URLSearchParams(u.search).get('d') || 'happiness';
    var base = '/thinker-arena/';
    var extras = [base + 'thinkers.json', base + 'debates/' + id + '.json'];
    if (!/\.en\.html$/.test(u.pathname)) {
      extras.push(base + 'audio/debate/' + id + '/manifest.json'); // may 404; tolerated
    }
    return extras;
  }

  // Fetch one article and cache it + its baked audio + images.
  function downloadArticle(path) {
    return caches.open(CACHE).then(function (c) {
      return fetch(path, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(path + ' ' + r.status);
        return r.text();
      }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var urls = assetsFromDoc(doc, path).concat(debateExtras(path));
        return Promise.all(urls.map(function (u) {
          return fetch(u, { cache: 'no-cache' }).then(function (res) {
            if (res.ok) return c.put(u, res);
          }).catch(function () {});
        }));
      });
    });
  }

  // The article page(s) an entry links to. Handles both shapes: the entry is
  // itself an <a> (e.g. mental-models), or a container holding article links
  // (e.g. deep-research, where one card links a plain + a deep version).
  function entryPages(entry) {
    var links = [];
    if (entry.tagName === 'A' && entry.getAttribute('href')) links.push(entry);
    entry.querySelectorAll('a[href]').forEach(function (a) { links.push(a); });
    var pages = [], seen = {};
    links.forEach(function (a) {
      var u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
      if (u.origin !== location.origin || !/\.html$/.test(u.pathname)) return;
      if (/\/index(\.\w+)?\.html$/.test(u.pathname)) return;
      // Keep the query when it selects the content (debate.html?d=<slug>);
      // without it every debate collapses onto the same shell URL and only the
      // default one ever gets cached.
      var key = u.pathname + (u.search || '');
      if (!seen[key]) { seen[key] = 1; pages.push(key); }
    });
    return pages;
  }

  var ENTRY_SEL = '.entry, a.topic-card';

  // Remove downloaded pages and the audio segments they reference. Segment
  // hashes come from the cached HTML, matched by filename so both the
  // same-origin layout and the R2 worker URLs are covered.
  function removePages(pages) {
    return caches.open(CACHE).then(function (c) {
      return Promise.all(pages.map(function (p) {
        return c.match(p).then(function (res) { return res || c.match(p, { ignoreSearch: true }); })
          .then(function (res) { return res ? res.text() : ''; })
          .then(function (html) {
            var hashes = [], re = /data-tts="([a-f0-9]+)"/gi, m;
            while ((m = re.exec(html))) hashes.push(m[1]);
            return c.keys().then(function (reqs) {
              var doomed = reqs.filter(function (r) {
                var u = new URL(r.url);
                return /\.mp3$/i.test(u.pathname) &&
                  hashes.some(function (h) { return u.pathname.indexOf('/' + h + '.mp3') >= 0; });
              });
              return Promise.all(doomed.map(function (r) { return c.delete(r); }));
            });
          })
          .then(function () {
            // A debate's text lives in JSON beside the shell — drop it too.
            var extras = debateExtras(p).filter(function (u) { return !/thinkers\.json$/.test(u); });
            return Promise.all(extras.map(function (u) { return c.delete(u); }));
          })
          .then(function () { return c.delete(p); });
      }));
    });
  }

  // Everything under one repo, marker included. Audio for migrated repos lives
  // on the R2 worker origin but keeps the same /<repo>/… pathname, so one
  // pathname test covers both.
  function removeRepo(slug) {
    return caches.open(CACHE).then(function (c) {
      return c.keys().then(function (reqs) {
        var doomed = reqs.filter(function (r) {
          var u = new URL(r.url);
          return u.pathname.indexOf('/' + slug + '/') === 0 ||
                 u.pathname.indexOf(REPO_MARK + slug) === 0 ||
                 u.pathname.indexOf(REPO_BUSY + slug) === 0;
        });
        return Promise.all(doomed.map(function (r) { return c.delete(r); }));
      });
    });
  }

  function mountEntryButtons() {
    var T = isEn
      ? { dl: 'Save offline', done: 'Saved offline', rm: 'Delete downloaded copy',
          rmAsk: 'Remove this from offline storage?' }
      : { dl: '离线下载', done: '已离线保存', rm: '删除已下载内容',
          rmAsk: '从离线存储中删除？' };

    caches.open(CACHE).then(function (c) {
      document.querySelectorAll(ENTRY_SEL).forEach(function (entry) {
        if (entry.querySelector('.entry-dl')) return;   // already mounted
        var pages = entryPages(entry);
        if (!pages.length) return;

        var isRow = entry.tagName === 'A'; // flat link row vs block card
        var bar = document.createElement('span');
        bar.className = 'entry-dl';
        bar.style.cssText =
          'position:absolute;z-index:5;display:flex;gap:5px;align-items:center;' +
          (isRow ? 'right:12px;top:50%;transform:translateY(-50%);' : 'right:14px;top:14px;');
        if (getComputedStyle(entry).position === 'static') entry.style.position = 'relative';
        // Reserve room so the buttons never overlap entry text.
        if (isRow) entry.style.paddingRight = '92px';

        function mk(text, title) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.title = title;
          b.style.cssText =
            'min-width:28px;height:28px;padding:0 8px;border-radius:14px;' +
            'border:1px solid rgba(123,97,255,.4);background:rgba(123,97,255,.12);' +
            'color:#7b61ff;font:600 14px -apple-system,sans-serif;cursor:pointer;line-height:26px;';
          b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
          return b;
        }
        // Two controls, each with one meaning: ⤓ downloads, 🗑 removes.
        var dl = mk('⤓', T.dl);
        var rm = mk('🗑', T.rm);
        rm.style.fontSize = '12px';
        rm.style.borderColor = 'rgba(255,255,255,.18)';
        rm.style.background = 'rgba(255,255,255,.05)';
        rm.style.color = '#7b8299';
        rm.style.display = 'none';
        bar.appendChild(dl);
        bar.appendChild(rm);

        function showSaved() {
          dl.dataset.done = '1';
          dl.style.fontSize = '14px';
          dl.textContent = '✓';
          dl.style.color = '#7ee2a8';
          dl.style.borderColor = 'rgba(126,226,168,.5)';
          dl.title = T.done;
          rm.style.display = '';
        }
        function showIdle() {
          delete dl.dataset.done;
          dl.style.fontSize = '14px';
          dl.textContent = '⤓';
          dl.style.color = '#7b61ff';
          dl.style.borderColor = 'rgba(123,97,255,.4)';
          dl.title = T.dl;
          rm.style.display = 'none';
        }

        Promise.all(pages.map(function (p) { return c.match(p); })).then(function (hits) {
          if (hits.every(Boolean)) showSaved();
        });

        var busy = false;
        dl.addEventListener('click', function () {
          if (busy || dl.dataset.done) return;
          busy = true;
          dl.style.fontSize = '10px';
          dl.textContent = '…';
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
          Promise.all(pages.map(downloadArticle)).then(showSaved).catch(function (err) {
            console.warn('[offline] entry download failed:', err);
            dl.style.fontSize = '14px';
            dl.textContent = '⚠';
            dl.style.color = '#ff9b9b';
          }).then(function () { busy = false; });
        });
        rm.addEventListener('click', function () {
          if (busy) return;
          if (!window.confirm(T.rmAsk)) return;
          busy = true;
          dl.textContent = '…';
          removePages(pages).then(showIdle).then(function () { busy = false; });
        });

        entry.appendChild(bar);
      });
    });
  }
})();
