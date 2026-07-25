/* BigCat Learning Hub — "已读 / read" markers.
 *
 * Loaded on every page by index-button.js (and directly by the hub landing).
 * Three behaviours, picked by page type:
 *
 *   • article page   -> a "标记已读" button at the very bottom, plus automatic
 *                       marking when you reach the end: either by scrolling to
 *                       the bottom, or by listening through to the last TTS
 *                       segment ("听完也算读完").
 *   • repo index     -> ✓ + dimmed styling on finished entries, and an
 *                       "已读 12 / 68" counter in the header.
 *   • hub landing    -> per-repo read count on each site card.
 *
 * Local-first: state lives in localStorage so it works offline and renders
 * instantly; when logged in it syncs to the account (POST /reads-list,
 * /reads-set) so phone and laptop agree. Changes made offline queue up and
 * flush on the next load.
 */
(function () {
  'use strict';

  var API = 'https://bigcat-engage.cissychen.workers.dev';
  var SESSION_KEY = 'bigcat-session';
  var STORE_KEY = 'bigcat-reads';      // { pages: {path: ts}, pending: {path: {read, ts}} }

  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
    || /\.en\.html$/i.test(location.pathname);
  var T = isEn
    ? { mark: 'Mark as read', done: '✓ Read', undo: 'Mark unread', count: 'read',
        addThought: '＋ A thought on this piece', thoughtPh: 'What did this piece leave you with?',
        save: 'Save', cancel: 'Cancel', edit: 'Click to edit' }
    : { mark: '标记已读', done: '✓ 已读', undo: '标为未读', count: '已读',
        addThought: '＋ 写下对这篇的想法', thoughtPh: '这篇给你留下了什么？',
        save: '保存', cancel: '取消', edit: '点击编辑' };

  function session() {
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
  }
  // pages[path] = { ts, read: bool, thought: string }. Earlier versions stored
  // a bare timestamp meaning "read"; upgrade those in place.
  function store() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (!s.pages) s.pages = {};
      if (!s.pending) s.pending = {};
      Object.keys(s.pages).forEach(function (p) {
        if (typeof s.pages[p] === 'number') s.pages[p] = { ts: s.pages[p], read: true, thought: '' };
      });
      return s;
    } catch (e) { return { pages: {}, pending: {} }; }
  }
  function save(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function entryOf(path) { return store().pages[path] || null; }
  function isRead(path) { var e = entryOf(path); return !!(e && e.read); }
  function thoughtOf(path) { var e = entryOf(path); return (e && e.thought) || ''; }

  function post(path, payload) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ session: session() }, payload)),
    }).then(function (r) { return r.json(); });
  }

  // Apply locally at once, then try the server; keep it queued until accepted.
  function mutate(path, patch, endpoint, payload) {
    var s = store();
    var e = s.pages[path] || { ts: Date.now(), read: false, thought: '' };
    if ('read' in patch) e.read = !!patch.read;
    if ('thought' in patch) e.thought = patch.thought;
    e.ts = Date.now();
    if (!e.read && !e.thought) delete s.pages[path]; else s.pages[path] = e;
    var pend = s.pending[path] || {};
    if ('read' in patch) pend.read = !!patch.read;
    if ('thought' in patch) pend.thought = patch.thought;
    pend.ts = e.ts;
    s.pending[path] = pend;
    save(s);
    if (!session()) return Promise.resolve();
    return post(endpoint, payload).then(function (res) {
      if (res && res.ok) {
        var s2 = store();
        var p2 = s2.pending[path];
        if (p2) {
          // Only clear the field we just pushed; another queued field may remain.
          if ('read' in patch) delete p2.read;
          if ('thought' in patch) delete p2.thought;
          if (!('read' in p2) && !('thought' in p2)) delete s2.pending[path];
          save(s2);
        }
      }
    }).catch(function () {});
  }
  function setRead(path, read) {
    return mutate(path, { read: read }, '/reads-set',
      { page: path, read: !!read, ts: Date.now() });
  }
  function setThought(path, text) {
    text = String(text || '');
    return mutate(path, { thought: text }, '/reads-thought',
      { page: path, thought: text, ts: Date.now() });
  }

  // Push anything queued, then pull the account's list and merge it in.
  function sync() {
    if (!session()) return Promise.resolve();
    var s = store();
    var pushes = [];
    Object.keys(s.pending).forEach(function (p) {
      var it = s.pending[p];
      if ('read' in it) {
        pushes.push(post('/reads-set', { page: p, read: it.read, ts: it.ts }).catch(function () {}));
      }
      if ('thought' in it) {
        pushes.push(post('/reads-thought', { page: p, thought: it.thought, ts: it.ts }).catch(function () {}));
      }
    });
    return Promise.all(pushes)
      .then(function () { return post('/reads-list', {}); })
      .then(function (res) {
        if (!res || !res.ok) return;
        var s2 = store();
        var merged = {};
        (res.reads || []).forEach(function (r) {
          merged[r.page] = { ts: r.ts, read: r.is_read !== 0, thought: r.thought || '' };
        });
        // Anything still queued locally wins over the server snapshot.
        Object.keys(s2.pending).forEach(function (p) {
          var pend = s2.pending[p];
          var e = merged[p] || { ts: pend.ts, read: false, thought: '' };
          if ('read' in pend) e.read = !!pend.read;
          if ('thought' in pend) e.thought = pend.thought;
          if (!e.read && !e.thought) delete merged[p]; else merged[p] = e;
        });
        s2.pages = merged;
        s2.pending = {};
        save(s2);
      })
      .catch(function () {});
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ---- page-type detection ------------------------------------------------

  function isLanding() {
    var p = location.pathname;
    return p === '/' || p === '/index.html' || p === '/index.en.html' || p === '/index.zh.html';
  }
  function isRepoIndex() {
    if (isLanding()) return false;
    return /^\/[^\/]+\/(index(\.en|\.zh)?\.html)?$/.test(location.pathname);
  }
  function repoSlug(path) {
    var m = /^\/?([^\/]+)\//.exec(String(path || ''));
    return m ? m[1] : '';
  }

  // ---- article page: bottom button + auto-mark ----------------------------

  function mountArticle() {
    var path = location.pathname;
    var btn = document.createElement('button');
    btn.id = 'read-btn';
    btn.type = 'button';
    btn.style.cssText =
      'display:block;margin:34px auto 8px;padding:11px 26px;border-radius:22px;' +
      'border:1px solid rgba(123,97,255,.45);background:rgba(123,97,255,.12);' +
      'color:#7b61ff;font:600 .95rem -apple-system,sans-serif;cursor:pointer;';

    function render() {
      var read = isRead(path);
      btn.textContent = read ? T.done : T.mark;
      btn.style.color = read ? '#3aa17e' : '#7b61ff';
      btn.style.borderColor = read ? 'rgba(58,161,126,.5)' : 'rgba(123,97,255,.45)';
      btn.style.background = read ? 'rgba(58,161,126,.10)' : 'rgba(123,97,255,.12)';
      btn.title = read ? T.undo : T.mark;
    }
    render();
    btn.addEventListener('click', function () {
      setRead(path, !isRead(path)).then(render);
      render();
    });

    // Sit at the very end of the article, before the footer / comments.
    var footer = document.querySelector('footer');
    var comments = document.getElementById('bigcat-comments');
    var anchor = comments || footer;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
    else document.body.appendChild(btn);

    function autoMark() {
      if (isRead(path)) return;
      setRead(path, true).then(render);
      render();
    }

    // (1) reaching the bottom of the page
    var sentinel = document.createElement('div');
    sentinel.style.cssText = 'height:1px';
    btn.parentNode.insertBefore(sentinel, btn);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) autoMark();
      }, { rootMargin: '0px 0px -10% 0px' }).observe(sentinel);
    }

    // (2) listening through to the last TTS segment. i18n-tts.js is a per-repo
    // copy (versions differ), so rather than patching it we watch the progress
    // readout it already maintains: "cur/total" hitting the final segment.
    var prog = document.querySelector('.mmd-controls .progress');
    if (prog && 'MutationObserver' in window) {
      new MutationObserver(function () {
        var m = /^(\d+)\s*\/\s*(\d+)$/.exec((prog.textContent || '').trim());
        if (m && +m[2] > 0 && +m[1] === +m[2]) autoMark();
      }).observe(prog, { childList: true, characterData: true, subtree: true });
    }

    // An article-level thought, right beside the read button.
    var box = buildThoughtEditor(path, function () {});
    box.style.margin = '10px auto 0';
    box.style.maxWidth = '640px';
    btn.parentNode.insertBefore(box, btn.nextSibling);

    // The account may resolve after first paint; re-render once synced.
    sync().then(function () { render(); box.refresh(); });
  }

  // Shared inline editor for an article-level thought. Used both at the bottom
  // of an article and beside each article row in the notes list.
  function buildThoughtEditor(path, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'thought-box';

    function show() {
      wrap.innerHTML = '';
      var t = thoughtOf(path);
      if (t) {
        var view = document.createElement('div');
        view.className = 'thought-view';
        view.textContent = t;
        view.title = T.edit;
        view.style.cssText =
          'padding:9px 12px;background:rgba(58,161,126,.10);border-left:3px solid rgba(58,161,126,.55);' +
          'border-radius:8px;font-size:.9rem;color:#cdd2e4;white-space:pre-wrap;cursor:text;';
        view.addEventListener('click', function (e) { e.stopPropagation(); edit(); });
        wrap.appendChild(view);
      } else {
        var add = document.createElement('button');
        add.type = 'button';
        add.textContent = T.addThought;
        add.style.cssText =
          'background:none;border:1px dashed rgba(255,255,255,.18);color:#7b8299;' +
          'font:inherit;font-size:.78rem;padding:5px 10px;border-radius:8px;cursor:pointer;';
        add.addEventListener('click', function (e) { e.stopPropagation(); edit(); });
        wrap.appendChild(add);
      }
    }
    function edit() {
      wrap.innerHTML = '';
      var ta = document.createElement('textarea');
      ta.value = thoughtOf(path);
      ta.placeholder = T.thoughtPh;
      ta.style.cssText =
        'width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(58,161,126,.45);' +
        'background:rgba(0,0,0,.2);color:#e4e6eb;font:inherit;font-size:.9rem;line-height:1.6;' +
        'resize:vertical;min-height:64px;';
      ta.addEventListener('click', function (e) { e.stopPropagation(); });
      var bar = document.createElement('div');
      bar.style.cssText = 'margin-top:7px;display:flex;gap:8px';
      function mkBtn(label, primary) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText =
          'padding:5px 12px;border-radius:8px;font:inherit;font-size:.78rem;cursor:pointer;' +
          (primary ? 'background:#3aa17e;color:#fff;border:1px solid #3aa17e;'
                   : 'background:rgba(255,255,255,.05);color:#a0a8c0;border:1px solid rgba(255,255,255,.12);');
        return b;
      }
      var ok = mkBtn(T.save, true), no = mkBtn(T.cancel, false);
      ok.addEventListener('click', function (e) {
        e.stopPropagation();
        setThought(path, ta.value.trim());
        show();
        if (onChange) onChange();
      });
      no.addEventListener('click', function (e) { e.stopPropagation(); show(); });
      bar.appendChild(ok); bar.appendChild(no);
      wrap.appendChild(ta); wrap.appendChild(bar);
      ta.focus();
    }
    show();
    wrap.refresh = show;
    return wrap;
  }

  // Exposed for the notes page, which renders its own article rows.
  window.BigCatReads = {
    isRead: isRead,
    thoughtOf: thoughtOf,
    setRead: setRead,
    setThought: setThought,
    sync: sync,
    thoughtEditor: buildThoughtEditor,
  };

  // ---- repo index: per-entry ticks + header counter -----------------------

  function entryPages(entry) {
    var links = [];
    if (entry.tagName === 'A' && entry.getAttribute('href')) links.push(entry);
    entry.querySelectorAll('a[href]').forEach(function (a) { links.push(a); });
    var out = [], seen = {};
    links.forEach(function (a) {
      var u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
      if (u.origin !== location.origin || !/\.html$/.test(u.pathname)) return;
      if (/\/index(\.\w+)?\.html$/.test(u.pathname)) return;
      if (!seen[u.pathname]) { seen[u.pathname] = 1; out.push(u.pathname); }
    });
    return out;
  }

  function mountRepoIndex() {
    var entries = [].slice.call(document.querySelectorAll('.entry'));
    if (!entries.length) return;

    var counter = document.createElement('div');
    counter.id = 'read-counter';
    counter.style.cssText =
      'text-align:center;margin:10px auto 0;font:600 .8rem "SF Mono",Menlo,monospace;' +
      'color:#7b61ff;opacity:.85';
    var header = document.querySelector('header');
    if (header) header.appendChild(counter);

    function paint() {
      var done = 0;
      entries.forEach(function (entry) {
        var pages = entryPages(entry);
        if (!pages.length) return;
        var read = pages.every(isRead);
        if (read) done++;
        var tick = entry.querySelector('.read-tick');
        if (read && !tick) {
          tick = document.createElement('span');
          tick.className = 'read-tick';
          tick.textContent = '✓';
          tick.title = T.done;
          tick.style.cssText =
            'position:absolute;left:6px;top:8px;color:#3aa17e;font:700 .8rem -apple-system,sans-serif;';
          if (getComputedStyle(entry).position === 'static') entry.style.position = 'relative';
          entry.appendChild(tick);
        } else if (!read && tick) {
          tick.remove();
        }
      });
      counter.textContent = T.count + ' ' + done + ' / ' + entries.length;
    }
    paint();
    sync().then(paint);
  }

  // ---- hub landing: per-repo read count ----------------------------------

  function mountLanding() {
    var cards = [].slice.call(document.querySelectorAll('a.card[href]'));
    if (!cards.length) return;

    function paint() {
      var pages = store().pages;
      var byRepo = {};
      Object.keys(pages).forEach(function (p) {
        var slug = repoSlug(p);
        if (slug) byRepo[slug] = (byRepo[slug] || 0) + 1;
      });
      cards.forEach(function (card) {
        var slug;
        try { slug = repoSlug(new URL(card.getAttribute('href'), location.origin).pathname); }
        catch (e) { return; }
        var n = byRepo[slug] || 0;
        var el = card.querySelector('.read-count');
        if (!n) { if (el) el.remove(); return; }
        if (!el) {
          el = document.createElement('div');
          el.className = 'read-count';
          el.style.cssText =
            'font-size:0.7rem;color:#3aa17e;font-family:"SF Mono",Menlo,monospace;' +
            'letter-spacing:0.3px;margin-top:2px';
          var meta = card.querySelector('.meta');
          (meta || card).appendChild(el);
        }
        el.textContent = '✓ ' + n;
      });
    }
    paint();
    sync().then(paint);
  }

  ready(function () {
    if (document.getElementById('read-btn') || document.getElementById('read-counter')) return;
    // Pull state on every page — the notes list renders article-level thoughts
    // from it and mounts no UI of its own here.
    if (!isLanding() && !isRepoIndex() && !repoSlug(location.pathname)) { sync(); return; }
    if (isLanding()) { mountLanding(); return; }
    if (isRepoIndex()) { mountRepoIndex(); return; }
    // Article pages: anything with real prose. Skip helper pages (notes,
    // account, confirm…), which live at the site root and aren't content.
    if (repoSlug(location.pathname) && document.querySelector('h1, h2')) mountArticle();
  });
})();
