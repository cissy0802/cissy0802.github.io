/* BigCat Learning Hub — highlight notes.
 *
 * Loaded on every content page by index-button.js, next to offline.js.
 * Open to anyone with an account (register at /account.html); each account's
 * notes are private to it.
 *
 *   • Select text on a page  -> a "＋ 笔记 / Note" bubble appears
 *   • Tap it                 -> the passage is saved with ~40 chars of context
 *                               on each side, queued locally, synced to the
 *                               Worker (POST /notes-add with the session token)
 *   • /notes.html            -> that account's notes, newest first; tapping one
 *                               opens the article at #note=<id>, which this
 *                               script then re-locates, scrolls to and flashes
 *
 * Offline-first: notes always land in localStorage immediately and flush to the
 * cloud whenever a request succeeds, so highlighting on a plane works fine.
 */
(function () {
  'use strict';

  var API = 'https://bigcat-engage.cissychen.workers.dev';
  var SESSION_KEY = 'bigcat-session';
  var EMAIL_KEY = 'bigcat-email';         // logged-in email, cached for offline.js owner check
  var QUEUE_KEY = 'bigcat-notes-queue';   // notes not yet accepted by the server
  var CACHE_KEY = 'bigcat-notes-cache';   // last known server list, for offline reads
  var CTX = 40;

  function session() {
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
  }
  function loginUrl() {
    // Match the account page to the reader's language, and bring them back to
    // exactly where they were after logging in.
    var page = isEn ? '/account.en.html' : '/account.html';
    return page + '?next=' + encodeURIComponent(location.pathname + location.search);
  }
  function readJSON(key, dflt) {
    try { return JSON.parse(localStorage.getItem(key)) || dflt; } catch (e) { return dflt; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  // Repo (仓) → display name, so /notes can group notes by topic site. Keep in
  // sync with the CARDS list in generate_hub.py; unknown slugs fall back to a
  // title-cased slug so a new site still groups sanely before it's added here.
  var REPOS = {
    'thinker-arena': { emoji: '⚖️', zh: '思想家圆桌辩论', en: 'Thinker Roundtable' },
    'deep-research': { emoji: '🔬', zh: '深度研究', en: 'Deep Research' },
    'synthesis': { emoji: '🔗', zh: '跨站合成', en: 'Cross-Site Synthesis' },
    'mental-models': { emoji: '📚', zh: '思维模型', en: 'Mental Models' },
    'meta-knowledge': { emoji: '🧠', zh: '元知识', en: 'Meta Knowledge' },
    'super-individual': { emoji: '⚡', zh: 'AI 超级个体实战', en: 'Super Individual' },
    'ai-ml': { emoji: '🤖', zh: 'AI / ML', en: 'AI & ML' },
    'system-design': { emoji: '🏗️', zh: 'System Design', en: 'System Design' },
    'cs-papers-deepread': { emoji: '📄', zh: 'IT 论文精读', en: 'CS Papers' },
    'chapter-deepread': { emoji: '📚', zh: '专业书籍精读', en: 'CS Books' },
    'leadership': { emoji: '🎯', zh: '领导力实践', en: 'Leadership' },
    'sales': { emoji: '🤝', zh: '销售实战', en: 'Sales' },
    'writing': { emoji: '✍️', zh: '写作与表达', en: 'Writing' },
    'health-longevity': { emoji: '🫀', zh: '健康长寿', en: 'Health & Longevity' },
    'parenting': { emoji: '👶', zh: '育儿与教育', en: 'Parenting' },
    'psychology': { emoji: '🧩', zh: '心理学', en: 'Psychology' },
    'family-craft': { emoji: '🧺', zh: '一起做', en: 'Doing Together' },
    'personal-finance': { emoji: '💵', zh: '个人理财', en: 'Personal Finance' },
    'philosophy': { emoji: '📜', zh: '哲学经典', en: 'Philosophy' },
    'buddhism': { emoji: '🪷', zh: '佛经', en: 'Buddhism' },
    'world-religions': { emoji: '🕉️', zh: '世界宗教', en: 'World Religions' },
    'art-aesthetics': { emoji: '🎨', zh: '艺术与审美', en: 'Art & Aesthetics' },
    'biographies': { emoji: '👩‍💼', zh: '人物传记', en: 'Biographies' },
    'book-recommendations': { emoji: '📖', zh: '好书推荐', en: 'Book Recommendations' },
    'deep-reading': { emoji: '📰', zh: '好书精读', en: 'Deep Reading' },
    'mathematics': { emoji: '📐', zh: '数学之美', en: 'Mathematics' },
    'history': { emoji: '🏛️', zh: '历史大事件', en: 'History' },
    'investing': { emoji: '📈', zh: '投资经典', en: 'Investing' },
    'civics-geopolitics': { emoji: '🌍', zh: '政治·法律·地缘', en: 'Civics & Geopolitics' },
    'neuroscience': { emoji: '🧠', zh: '神经科学', en: 'Neuroscience' },
    'physics': { emoji: '⚛️', zh: '物理', en: 'Physics' },
    'complexity-science': { emoji: '🌀', zh: '复杂性科学', en: 'Complexity Science' }
  };
  function repoSlug(page) {
    var m = /^\/?([^\/]+)\//.exec(String(page || ''));
    return m ? m[1] : '';
  }
  function repoLabel(page, lang) {
    var slug = repoSlug(page);
    var info = REPOS[slug];
    if (info) return (info.emoji ? info.emoji + ' ' : '') + (lang === 'en' ? info.en : info.zh);
    // Unknown repo: title-case the slug ("world-religions" → "World Religions").
    if (!slug) return lang === 'en' ? 'Other' : '其他';
    return slug.replace(/(^|-)([a-z])/g, function (_, d, c) {
      return (d ? ' ' : '') + c.toUpperCase();
    });
  }


  // Some pages render several distinct pieces from one file, picked by a query
  // param — thinker-arena's debate.html?d=<slug> is the case here. Keying a
  // note on the pathname alone collapsed every debate into one entry and made
  // "jump back" land on the default one. Keep params that choose content; drop
  // the ones that are only tracking or UI state.
  var NOISE_PARAMS = /^(me|ref|fbclid|gclid|utm_[a-z]+)$/i;
  function pageKey() {
    var params = new URLSearchParams(location.search);
    var keep = new URLSearchParams();
    var names = [];
    params.forEach(function (v, k) { names.push(k); });
    names.sort().forEach(function (k) {
      if (!NOISE_PARAMS.test(k)) keep.append(k, params.get(k));
    });
    var q = keep.toString();
    return location.pathname + (q ? '?' + q : '');
  }

  // The most specific title this page offers. Client-rendered pages often keep
  // a generic <title> and put the real subject in the header, so prefer that.
  function pageTitle() {
    var sub = document.getElementById('chan-sub');
    if (sub && sub.textContent.trim()) return sub.textContent.trim().slice(0, 300);
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim().slice(0, 300);
    return (document.title || '').replace(/\s*·\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim().slice(0, 300);
  }

  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
    || /\.en\.html$/i.test(location.pathname);
  var T = isEn
    ? { add: '＋ Note', saved: '✓ Saved', queued: '✓ Saved (offline)', login: 'Log in to save notes',
        thoughtPh: 'Your thought on this passage…', save: 'Save', cancel: 'Cancel',
        del: 'Delete', delConfirm: 'Delete this highlight?', tapToWrite: 'Tap to write a thought',
        myNote: 'My note' }
    : { add: '＋ 笔记', saved: '✓ 已保存', queued: '✓ 已保存（离线）', login: '登录后即可保存笔记',
        thoughtPh: '写下你对这段的感想…', save: '保存', cancel: '取消',
        del: '删除', delConfirm: '删除这条划线？', tapToWrite: '点击写感想',
        myNote: '我的笔记' };

  // ---------- sync ---------------------------------------------------------

  function post(path, payload) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ session: session() }, payload)),
    }).then(function (r) { return r.json(); });
  }

  function flushQueue() {
    var q = readJSON(QUEUE_KEY, []);
    if (!q.length || !session() || !navigator.onLine) return Promise.resolve();
    return q.reduce(function (chain, note) {
      return chain.then(function () {
        return post('/notes-add', note).then(function (res) {
          if (res && res.ok) {
            var left = readJSON(QUEUE_KEY, []).filter(function (n) { return n.id !== note.id; });
            writeJSON(QUEUE_KEY, left);
            // Accepted notes must land in the local cache too. Without this a
            // just-saved note exists only on the server until the next full
            // /notes-list, so anything reading local state — the underlines on
            // the article, the offline list — can't see it yet.
            var cache = readJSON(CACHE_KEY, []);
            if (!cache.some(function (n) { return n.id === note.id; })) {
              cache.unshift(note);
              writeJSON(CACHE_KEY, cache);
            }
          }
        }).catch(function () {});
      });
    }, Promise.resolve());
  }

  function saveNote(note) {
    var q = readJSON(QUEUE_KEY, []);
    q.push(note);
    writeJSON(QUEUE_KEY, q);
    return flushQueue();
  }

  window.addEventListener('online', flushQueue);

  // Exposed for notes.html: merged server + not-yet-synced view.
  window.BigCatNotes = {
    api: API,
    loginUrl: loginUrl,
    isLoggedIn: function () { return !!session(); },
    me: function () {
      if (!session()) return Promise.resolve(null);
      return post('/auth-me', {}).then(function (r) {
        if (r && r.ok) {
          // Cache the email so offline.js can gate its owner-only button
          // without its own round-trip.
          try { localStorage.setItem(EMAIL_KEY, r.email); } catch (e) {}
          return r.email;
        }
        // Session expired or revoked — drop it so the UI asks for a login.
        try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(EMAIL_KEY); } catch (e) {}
        return null;
      }).catch(function () { return null; });
    },
    logout: function () {
      var s = session();
      try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(EMAIL_KEY); } catch (e) {}
      return post('/auth-logout', { session: s }).catch(function () {});
    },
    repoSlug: repoSlug,
    repoLabel: repoLabel,
    flush: flushQueue,
    list: function () {
      var pending = readJSON(QUEUE_KEY, []);
      return post('/notes-list', {}).then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error);
        writeJSON(CACHE_KEY, res.notes);
        return merge(res.notes, pending);
      }).catch(function () {
        return merge(readJSON(CACHE_KEY, []), pending);
      });
    },
    remove: function (id) {
      var left = readJSON(QUEUE_KEY, []).filter(function (n) { return n.id !== id; });
      writeJSON(QUEUE_KEY, left);
      writeJSON(CACHE_KEY, readJSON(CACHE_KEY, []).filter(function (n) { return n.id !== id; }));
      return post('/notes-delete', { id: id }).catch(function () { return { ok: false }; });
    },
    // Set the free-text comment on a note (the reader's own words, separate
    // from the highlighted passage). Writes through to the cache immediately
    // and re-queues on failure, so editing works offline like saving does.
    setComment: function (id, comment) {
      comment = String(comment || '');
      var cache = readJSON(CACHE_KEY, []);
      var note = null;
      cache.forEach(function (n) { if (n.id === id) { n.comment = comment; note = n; } });
      writeJSON(CACHE_KEY, cache);
      var q = readJSON(QUEUE_KEY, []);
      var inQueue = false;
      q.forEach(function (n) { if (n.id === id) { n.comment = comment; note = note || n; inQueue = true; } });
      if (inQueue) writeJSON(QUEUE_KEY, q);
      if (!note) return Promise.resolve({ ok: false });
      var requeue = function () {
        var qq = readJSON(QUEUE_KEY, []);
        if (!qq.some(function (n) { return n.id === id; })) { qq.push(note); writeJSON(QUEUE_KEY, qq); }
      };
      return post('/notes-add', note).then(function (res) {
        if (!res || !res.ok) requeue();
        return res || { ok: false };
      }).catch(function () { requeue(); return { ok: false }; });
    },
  };

  function merge(server, pending) {
    var seen = {};
    var out = [];
    pending.concat(server).forEach(function (n) {
      if (!seen[n.id]) { seen[n.id] = 1; out.push(n); }
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out;
  }

  // ---------- locating a saved passage again -------------------------------

  function textNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode.nodeName;
        if (p === 'SCRIPT' || p === 'STYLE' || p === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // Rebuild the page's visible text with an index back to (node, offset), then
  // find the note by its prefix+text+suffix; fall back to the text alone.
  function locate(note) {
    var nodes = textNodes(document.body);
    var full = '', map = [];
    nodes.forEach(function (node) {
      map.push({ node: node, start: full.length });
      full += node.nodeValue;
    });
    var idx = -1;
    if (note.prefix || note.suffix) idx = full.indexOf(note.prefix + note.text + note.suffix);
    if (idx >= 0) idx += note.prefix.length;
    else idx = full.indexOf(note.text);
    if (idx < 0) return null;

    function pos(offset) {
      for (var i = map.length - 1; i >= 0; i--) {
        if (map[i].start <= offset) {
          return { node: map[i].node, offset: offset - map[i].start };
        }
      }
      return null;
    }
    var a = pos(idx), b = pos(idx + note.text.length);
    if (!a || !b) return null;
    var range = document.createRange();
    try {
      range.setStart(a.node, Math.min(a.offset, a.node.nodeValue.length));
      range.setEnd(b.node, Math.min(b.offset, b.node.nodeValue.length));
    } catch (e) { return null; }
    return range;
  }

  function flash(range) {
    var mark = document.createElement('mark');
    mark.style.cssText =
      'background:linear-gradient(transparent 55%,rgba(255,214,102,.85) 55%);' +
      'color:inherit;padding:0;transition:background 1.2s;';
    try {
      range.surroundContents(mark);
    } catch (e) {
      // Selection spans element boundaries — fall back to scrolling to its start.
      var el = range.startContainer.parentElement;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () {
      mark.style.background = 'linear-gradient(transparent 55%,rgba(255,214,102,.28) 55%)';
    }, 2600);
  }

  // ---------- persistent underlines on the article -------------------------

  // Draw every note saved on THIS page as an underline in the text, so a page
  // you've highlighted before still shows what you marked. Uses the same
  // prefix+text+suffix re-location as jumping to a note, and skips passages
  // that can't be wrapped cleanly (a selection spanning element boundaries).
  function paintUnderlines() {
    var here = pageKey();
    var all = readJSON(QUEUE_KEY, []).concat(readJSON(CACHE_KEY, []));
    var seen = {};
    all.forEach(function (n) {
      if (!n || n.page !== here || seen[n.id]) return;
      seen[n.id] = 1;
      if (document.querySelector('[data-note-id="' + n.id + '"]')) return;
      var range = locate(n);
      if (!range) return;
      var marks = wrapRange(range, n);
      if (!marks.length) return;
      marks.forEach(function (mark) {
        mark.addEventListener('click', function (ev) {
          // Only a plain tap opens the editor; dragging out a fresh selection
          // that happens to start here should still make a new note.
          if (String(window.getSelection())) return;
          ev.preventDefault();
          ev.stopPropagation();
          openThought(mark, n.id);
        });
      });
    });
  }


  // Underline a range that may cross element boundaries. surroundContents()
  // throws on those, and most prose here has inline <strong>/<em> inside the
  // sentence — so wrap each intersecting text node separately instead. One
  // logical note can therefore own several <mark>s.
  function wrapRange(range, note) {
    var out = [];
    var root = range.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentNode;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        if (!t.nodeValue) return NodeFilter.FILTER_REJECT;
        var p = t.parentNode.nodeName;
        if (p === 'SCRIPT' || p === 'STYLE' || p === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return range.intersectsNode(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    var nodes = [], t;
    while ((t = walker.nextNode())) nodes.push(t);
    nodes.forEach(function (node) {
      var from = (node === range.startContainer) ? range.startOffset : 0;
      var to = (node === range.endContainer) ? range.endOffset : node.nodeValue.length;
      if (to <= from) return;
      var r = document.createRange();
      try {
        r.setStart(node, from);
        r.setEnd(node, to);
      } catch (e) { return; }
      if (!r.toString().trim()) return;
      var mark = document.createElement('mark');
      mark.className = 'bigcat-note-mark';
      mark.setAttribute('data-note-id', note.id);
      styleMark(mark, note.comment);
      try {
        r.surroundContents(mark); // single text node — always safe
        out.push(mark);
      } catch (e) {}
    });
    return out;
  }

  // A passage that carries a thought gets a solid underline; a bare highlight
  // a dotted one — so you can see at a glance where you've written something.
  function styleMark(mark, comment) {
    mark.style.cssText =
      'background:none;color:inherit;padding:0;cursor:pointer;' +
      'border-bottom:2px ' + (comment ? 'solid' : 'dotted') + ' rgba(255,214,102,.85);';
    mark.title = T.myNote + (comment ? '：' + comment : '（' + T.tapToWrite + '）');
  }

  // ---------- inline thought editor on a highlight -------------------------

  function marksOf(id) {
    return [].slice.call(document.querySelectorAll('mark.bigcat-note-mark[data-note-id="' + id + '"]'));
  }

  var openEditor = null;
  function closeThought() {
    if (openEditor) { openEditor.remove(); openEditor = null; }
  }
  document.addEventListener('click', function () { closeThought(); });

  function openThought(mark, id) {
    closeThought();
    var all = readJSON(QUEUE_KEY, []).concat(readJSON(CACHE_KEY, []));
    var note = all.filter(function (n) { return n.id === id; })[0];
    if (!note) return;

    var box = document.createElement('div');
    box.id = 'note-thought-editor';
    box.style.cssText =
      'position:absolute;z-index:10001;width:min(320px,calc(100vw - 24px));' +
      'padding:12px;border-radius:12px;background:#1e1e32;color:#e4e6eb;' +
      'border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 28px rgba(0,0,0,.45);' +
      'font:400 14px -apple-system,sans-serif;';
    box.addEventListener('click', function (e) { e.stopPropagation(); });

    var head = document.createElement('div');
    head.textContent = T.myNote;
    head.style.cssText =
      'font:700 11px "SF Mono",Menlo,monospace;letter-spacing:.5px;color:#ffd666;margin-bottom:7px;';
    box.appendChild(head);

    var quote = document.createElement('div');
    quote.textContent = note.text;
    quote.style.cssText =
      'font-size:12px;color:#a0a8c0;border-left:2px solid rgba(255,214,102,.7);' +
      'padding-left:8px;margin-bottom:9px;max-height:56px;overflow:hidden;';
    box.appendChild(quote);

    var ta = document.createElement('textarea');
    ta.value = note.comment || '';
    ta.placeholder = T.thoughtPh;
    ta.style.cssText =
      'width:100%;min-height:76px;padding:8px 10px;border-radius:8px;' +
      'border:1px solid rgba(123,97,255,.45);background:rgba(0,0,0,.25);color:#e4e6eb;' +
      'font:inherit;line-height:1.6;resize:vertical;';
    box.appendChild(ta);

    var bar = document.createElement('div');
    bar.style.cssText = 'margin-top:9px;display:flex;gap:8px;align-items:center';
    function mk(label, css) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'padding:5px 12px;border-radius:8px;font:inherit;font-size:13px;cursor:pointer;' + css;
      return b;
    }
    var save = mk(T.save, 'background:#7b61ff;color:#fff;border:1px solid #7b61ff;');
    var cancel = mk(T.cancel, 'background:rgba(255,255,255,.06);color:#a0a8c0;border:1px solid rgba(255,255,255,.14);');
    var del = mk(T.del, 'margin-left:auto;background:none;color:#ff8a8a;border:1px solid rgba(255,107,107,.35);');

    save.addEventListener('click', function () {
      var v = ta.value.trim();
      note.comment = v;
      window.BigCatNotes.setComment(id, v);
      marksOf(id).forEach(function (m) { styleMark(m, v); });
      closeThought();
    });
    cancel.addEventListener('click', closeThought);
    del.addEventListener('click', function () {
      if (!window.confirm(T.delConfirm)) return;
      window.BigCatNotes.remove(id);
      marksOf(id).forEach(function (m) { m.replaceWith.apply(m, m.childNodes); });
      closeThought();
    });
    bar.appendChild(save); bar.appendChild(cancel); bar.appendChild(del);
    box.appendChild(bar);

    document.body.appendChild(box);
    // Below the passage when there's room, above it otherwise.
    var r = mark.getBoundingClientRect();
    var h = box.offsetHeight, w = box.offsetWidth;
    var top = (r.bottom + 8 + h <= window.innerHeight) ? r.bottom + 8 : r.top - h - 8;
    var left = Math.max(10, Math.min(r.left, window.innerWidth - w - 10));
    box.style.top = (window.scrollY + top) + 'px';
    box.style.left = (window.scrollX + left) + 'px';
    openEditor = box;
    ta.focus();
  }

  // Re-locating walks every text node, so coalesce bursts (e.g. save + sync).
  var repaintTimer = null;
  function schedulePaint() {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(paintUnderlines, 150);
  }

  // #note=<id> — arriving from the notes list. Works from the local queue or
  // the cached server list, so it also resolves offline.
  function handleHash() {
    var m = /[#&]note=([\w-]+)/.exec(location.hash);
    if (!m) return;
    var id = m[1];
    var all = readJSON(QUEUE_KEY, []).concat(readJSON(CACHE_KEY, []));
    var note = all.filter(function (n) { return n.id === id; })[0];
    if (!note) return;
    var range = locate(note);
    if (range) flash(range);
  }

  // ---------- the "＋ 笔记" bubble ------------------------------------------

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    if (document.getElementById('note-bubble')) return;

    // Underline what's already saved for this page (from the local cache, so
    // it shows instantly and offline), then again once the server list lands.
    paintUnderlines();
    flushQueue().then(function () {
      if (!session()) return;
      return window.BigCatNotes.list().then(schedulePaint);
    });
    handleHash();
    window.addEventListener('hashchange', handleHash);

    // Client-rendered pages (thinker-arena debates) build their text after this
    // runs, so the first pass has nothing to underline or scroll to. Retry a
    // few times, stopping as soon as the page stops growing.
    var lastLen = -1, tries = 0;
    var settle = setInterval(function () {
      var len = document.body.textContent.length;
      if (len !== lastLen) { lastLen = len; paintUnderlines(); handleHash(); }
      if (++tries >= 8) clearInterval(settle);
    }, 500);

    var bubble = document.createElement('button');
    bubble.id = 'note-bubble';
    bubble.textContent = T.add;
    bubble.style.cssText =
      'position:absolute;z-index:10000;display:none;padding:7px 13px;border-radius:16px;' +
      'border:1px solid rgba(255,255,255,.18);background:#7b61ff;color:#fff;' +
      'font:600 13px -apple-system,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);';
    document.body.appendChild(bubble);

    var pending = null; // { text, prefix, suffix }

    function hide() { bubble.style.display = 'none'; pending = null; }

    function onSelect() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hide(); return; }
      var text = sel.toString().trim();
      if (text.length < 2) { hide(); return; }
      if (bubble.contains(sel.anchorNode)) return;

      // Context on both sides, so the same sentence can be found again even if
      // it appears more than once on the page.
      var range = sel.getRangeAt(0);
      var pre = document.createRange();
      pre.setStart(document.body, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      var before = pre.toString();
      var post = document.createRange();
      post.setStart(range.endContainer, range.endOffset);
      post.setEnd(document.body, document.body.childNodes.length);
      var after = post.toString();

      pending = {
        text: text,
        prefix: before.slice(-CTX),
        suffix: after.slice(0, CTX),
      };

      // Sit BELOW the selection: iOS pins its own copy/lookup callout above it,
      // and the two used to overlap. Flip back above only when there isn't room
      // below (selection near the bottom of the viewport).
      var r = range.getBoundingClientRect();
      bubble.textContent = T.add;
      bubble.style.display = 'block';
      var GAP = 12;
      var h = bubble.offsetHeight || 34;
      var below = r.bottom + GAP;
      var top = (below + h <= window.innerHeight) ? below : (r.top - h - GAP);
      bubble.style.top = (window.scrollY + top) + 'px';
      // Keep it fully on screen horizontally too.
      var w = bubble.offsetWidth;
      var left = r.left + r.width / 2 - w / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      bubble.style.left = (window.scrollX + left) + 'px';
    }

    document.addEventListener('selectionchange', function () {
      // Let the selection settle (iOS fires this mid-drag).
      clearTimeout(onSelect._t);
      onSelect._t = setTimeout(onSelect, 250);
    });

    bubble.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bubble.addEventListener('click', function () {
      if (!pending) return;
      // Not logged in: send them to the account page and come straight back.
      if (!session()) {
        bubble.textContent = T.login;
        setTimeout(function () { location.href = loginUrl(); }, 600);
        return;
      }

      var note = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())).replace(/-/g, ''),
        page: pageKey(),
        title: pageTitle(),
        lang: isEn ? 'en' : 'zh',
        text: pending.text,
        prefix: pending.prefix,
        suffix: pending.suffix,
        comment: '',
        ts: Date.now(),
      };
      bubble.textContent = navigator.onLine ? T.saved : T.queued;
      saveNote(note);
      window.getSelection().removeAllRanges();
      schedulePaint(); // underline it straight away
      setTimeout(hide, 1100);
    });

    document.addEventListener('scroll', function () {
      if (bubble.style.display === 'block' && !pending) hide();
    }, { passive: true });
  });
})();
