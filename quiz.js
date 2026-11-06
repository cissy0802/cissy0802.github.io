(function () {
  'use strict';
  var EN = /\.en\.html$/.test(location.pathname);
  var T = EN ? {
    login: 'Sign in to take the quiz. Questions come from the articles you have read.',
    loginBtn: 'Sign in / Register', accountUrl: '/account.en.html?next=/quiz.en.html',
    notReady: "The articles you have read don't have questions yet. The bank grows daily, so check back soon.",
    readFirst: 'Questions only come from articles you have read. Read a few first: reaching the end of an article marks it as read.',
    goRead: 'Find something to read', home: '/index.en.html',
    short: function (n) { return 'The articles you have read have only ' + n + ' questions so far. The bank grows daily.'; },
    drawing: 'Drawing questions…', loadBank: "Couldn't load the questions. Please refresh.", loadAll: "Couldn't load the page. Please refresh.",
    again: '↺ Missed last time', source: 'Back to the article →', right: '✓ Correct.',
    wrong: function (k) { return '✗ The answer is ' + k + '.'; },
    unsaved: function (n) { return '⚠️ ' + n + ' answer(s) were not saved and may come up again.'; },
    left: function (n) { return n + ' left'; }, finished: 'Done',
    stat: function (n, p) { return n + ' answers so far, ' + p + '% correct'; }
  } : {
    login: '登录后才能做题，这样才知道你读过什么、做过什么。',
    loginBtn: '登录 / 注册', accountUrl: '/account.html?next=/quiz.html',
    notReady: '你读过的文章还没有题，题库每天都在补，过几天再来。',
    readFirst: '题目只从你读过的文章里出。先去读几篇，读到文章末尾就会自动记为已读。',
    goRead: '去读文章', home: '/index.zh.html',
    short: function (n) { return '你读过的文章目前只有 ' + n + ' 题，题库每天都在补。'; },
    drawing: '抽题中…', loadBank: '题目加载失败，刷新页面再试一次。', loadAll: '加载失败，刷新页面再试一次。',
    again: '↺ 上次答错', source: '回原文 →', right: '✓ 对了。',
    wrong: function (k) { return '✗ 答案是 ' + k + '。'; },
    unsaved: function (n) { return '⚠️ ' + n + ' 道题的记录没存上，下次可能再抽到。'; },
    left: function (n) { return '还剩 ' + n + ' 题'; }, finished: '完成',
    stat: function (n, p) { return '累计答过 ' + n + ' 次，正确率 ' + p + '%'; }
  };
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var API = LOCAL ? 'http://localhost:8787' : 'https://bigcat-engage.cissychen.workers.dev';
  var ROUND = 10, MAX_RETRY = 3;   // at most this many earlier mistakes per round
  var KEYS = ['A', 'B', 'C', 'D'];
  var $ = function (id) { return document.getElementById(id); };
  var manifest, readSet = {}, history = {}, round = [], lastRound = {}, failed = 0;

  function session() { try { return localStorage.getItem('bigcat-session') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function post(path, body) {
    body.session = session();
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 401) { var e = new Error('unauthorized'); e.auth = true; throw e; }
        return r.json();
      });
  }
  function shuffled(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function message(html) { $('list').innerHTML = '<div class="empty">' + html + '</div>'; }
  function askLogin() {
    message(esc(T.login) + '<br><br><a class="btn" href="' + T.accountUrl + '">' + esc(T.loginBtn) + '</a>');
  }
  function bankKey(page) {
    var p = page.replace(/\.en\.html/, '.html');
    return (manifest.aliases && manifest.aliases[p]) || p;
  }

  // Only articles this reader has read: a few earlier mistakes, then never-seen
  // questions, then the ones answered right longest ago. One question per article
  // first; a second from the same article only if that leaves the round short.
  function pick() {
    var pool = [];
    Object.keys(manifest.pages).forEach(function (page) {
      if (!readSet[page]) return;
      manifest.pages[page].q.forEach(function (id) {
        pool.push({ id: id, page: page, h: history[id] });
      });
    });
    var fresh = pool.filter(function (x) { return !lastRound[x.id]; });
    if (fresh.length >= ROUND) pool = fresh;
    var wrong = shuffled(pool.filter(function (x) { return x.h && !x.h.last_correct; }));
    var unseen = shuffled(pool.filter(function (x) { return !x.h; }));
    var right = pool.filter(function (x) { return x.h && x.h.last_correct; })
      .sort(function (a, b) { return a.h.ts - b.h.ts; });
    var order = wrong.slice(0, MAX_RETRY).concat(unseen, right, wrong.slice(MAX_RETRY));
    var out = [], pages = {};
    order.forEach(function (x) {
      if (out.length < ROUND && !pages[x.page]) { pages[x.page] = 1; out.push(x); }
    });
    order.forEach(function (x) {
      if (out.length < ROUND && out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  function loadRound() {
    var picks = pick();
    if (!picks.length) {
      message(Object.keys(readSet).length ? esc(T.notReady)
        : esc(T.readFirst) + '<br><br><a class="btn" href="' + T.home + '">' + esc(T.goRead) + '</a>');
      return;
    }
    $('short').textContent = picks.length < ROUND
      ? T.short(picks.length) : '';
    $('done').classList.remove('on');
    message(T.drawing);
    var files = {};
    picks.forEach(function (x) { files[x.page] = 1; });
    Promise.all(Object.keys(files).map(function (page) {
      return fetch('/quiz/' + manifest.pages[page].f).then(function (r) {
        if (!r.ok) throw new Error('bank ' + r.status);
        return r.json();
      }).then(function (d) { files[page] = d; });
    })).then(function () {
      round = [];
      picks.forEach(function (x) {
        var d = files[x.page];
        var q = d.questions.filter(function (y) { return y.id === x.id; })[0];
        if (!q) return;
        var order = shuffled([0, 1, 2, 3]);   // a new order each time, so nobody memorises "it was C"
        var opts = EN ? q.options_en : q.options;
        round.push({ id: q.id, page: x.page, link: (EN && d.page_en) || x.page,
          title: (EN && d.title_en) || d.title, again: !!(x.h && !x.h.last_correct),
          question: EN ? q.question_en : q.question, explanation: EN ? q.explanation_en : q.explanation,
          options: order.map(function (j) { return opts[j]; }), answer: order.indexOf(q.answer), picked: null });
      });
      lastRound = {};
      round.forEach(function (q) { lastRound[q.id] = 1; });
      render();
    }).catch(function () { message(T.loadBank); });
  }

  function render() {
    failed = 0;
    $('warn').textContent = '';
    $('score').classList.add('on');
    $('list').innerHTML = round.map(function (q, i) {
      var tags = '<span>' + (i + 1) + ' / ' + round.length + '</span><span>' + esc(q.title) + '</span>' +
        (q.again ? '<span class="again">' + T.again + '</span>' : '');
      var opts = q.options.map(function (o, j) {
        return '<button class="opt" data-i="' + i + '" data-j="' + j + '"><span class="k">' + KEYS[j] + '</span><span>' + esc(o) + '</span></button>';
      }).join('');
      return '<section class="q" id="q' + i + '"><div class="meta">' + tags + '</div><p class="stem">' + esc(q.question) + '</p>' + opts +
        '<div class="explain"><b></b> ' + esc(q.explanation) + ' <a href="' + esc(q.link) + '" target="_blank" rel="noopener">' + T.source + '</a></div></section>';
    }).join('');
    tally();
    window.scrollTo(0, 0);
  }

  function choose(i, j) {
    var q = round[i];
    if (q.picked !== null) return;
    q.picked = j;
    var ok = j === q.answer, el = $('q' + i);
    el.querySelectorAll('.opt').forEach(function (b, k) {
      b.disabled = true;
      if (k === q.answer) b.classList.add('right'); else if (k === j) b.classList.add('wrong');
    });
    var v = el.querySelector('.explain b');
    v.textContent = ok ? T.right : T.wrong(KEYS[q.answer]);
    v.className = ok ? 'ok' : 'bad';
    el.classList.add('done');
    var prev = history[q.id] || { right_n: 0, wrong_n: 0 };
    history[q.id] = { right_n: prev.right_n + (ok ? 1 : 0), wrong_n: prev.wrong_n + (ok ? 0 : 1), last_correct: ok ? 1 : 0, ts: Date.now() };
    post('/quiz-answer', { qid: q.id, page: q.page, correct: ok }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
    }).catch(function () {
      failed++;
      $('warn').textContent = T.unsaved(failed);
    });
    tally();
  }

  function tally() {
    var n = round.length, done = 0, right = 0;
    round.forEach(function (q) { if (q.picked !== null) { done++; if (q.picked === q.answer) right++; } });
    $('sc').textContent = right; $('tot').textContent = n;
    $('bar').style.width = (n ? done / n * 100 : 0) + '%';
    $('left').textContent = done < n ? T.left(n - done) : T.finished;
    if (n && done === n) {
      $('big').textContent = right + ' / ' + n;
      var R = 0, W = 0;
      Object.keys(history).forEach(function (k) { R += history[k].right_n; W += history[k].wrong_n; });
      $('stat').textContent = T.stat(R + W, Math.round(R / (R + W) * 100));
      $('done').classList.add('on');
    }
  }

  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('.opt');
    if (b) choose(+b.dataset.i, +b.dataset.j);
  });
  $('again').addEventListener('click', loadRound);

  if (!session()) { askLogin(); return; }
  Promise.all([
    fetch('/quiz/manifest.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('manifest'); return r.json(); }),
    post('/reads-list', {}),
    post('/quiz-history', {})
  ]).then(function (res) {
    manifest = res[0];
    (res[1].reads || []).forEach(function (r) { if (r.is_read) readSet[bankKey(r.page)] = 1; });
    (res[2].answers || []).forEach(function (a) { history[a.qid] = a; });
    loadRound();
  }).catch(function (e) {
    if (e.auth) askLogin(); else message(T.loadAll);
  });
})();
