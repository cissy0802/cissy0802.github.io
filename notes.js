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
  var QUEUE_KEY = 'bigcat-notes-queue';   // notes not yet accepted by the server
  var CACHE_KEY = 'bigcat-notes-cache';   // last known server list, for offline reads
  var CTX = 40;

  function session() {
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
  }
  function loginUrl() {
    return '/account.html?next=' + encodeURIComponent(location.pathname + location.search);
  }
  function readJSON(key, dflt) {
    try { return JSON.parse(localStorage.getItem(key)) || dflt; } catch (e) { return dflt; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
    || /\.en\.html$/i.test(location.pathname);
  var T = isEn
    ? { add: '＋ Note', saved: '✓ Saved', queued: '✓ Saved (offline)', login: 'Log in to save notes' }
    : { add: '＋ 笔记', saved: '✓ 已保存', queued: '✓ 已保存（离线）', login: '登录后即可保存笔记' };

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
        if (r && r.ok) return r.email;
        // Session expired or revoked — drop it so the UI asks for a login.
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        return null;
      }).catch(function () { return null; });
    },
    logout: function () {
      var s = session();
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
      return post('/auth-logout', { session: s }).catch(function () {});
    },
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

    flushQueue();
    handleHash();
    window.addEventListener('hashchange', handleHash);

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

      var r = range.getBoundingClientRect();
      bubble.textContent = T.add;
      bubble.style.display = 'block';
      bubble.style.top = (window.scrollY + r.top - 44) + 'px';
      bubble.style.left = (window.scrollX + r.left + r.width / 2 - bubble.offsetWidth / 2) + 'px';
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
        page: location.pathname,
        title: (document.title || '').replace(/\s*·\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim(),
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
      setTimeout(hide, 1100);
    });

    document.addEventListener('scroll', function () {
      if (bubble.style.display === 'block' && !pending) hide();
    }, { passive: true });
  });
})();
