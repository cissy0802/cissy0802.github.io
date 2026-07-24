/* BigCat Learning Hub — shared comments loader (login-free, no GitHub required).
 * Replaces Giscus. Comments are stored in the Cloudflare Worker + D1 backend
 * (see engage-backend/). Each page's thread is keyed by pathname.
 * Also injects an AI-content disclaimer above the comments on content pages.
 *
 * User content is rendered with textContent only — never innerHTML — so a
 * comment body can never inject markup or scripts.
 */
(function () {
  // ======= CONFIG ===========================================================
  // Set this to your deployed Worker URL (same value as in engage.js).
  var API = window.BIGCAT_API || "https://bigcat-engage.cissychen.workers.dev";
  // Optional: paste a Cloudflare Turnstile site key to require a captcha.
  // Leave "" to rely on honeypot + server rate-limit only.
  var TURNSTILE_SITEKEY = "0x4AAAAAADu325m36GEOOMP-";
  // ==========================================================================

  var isEn = (document.documentElement.lang || "").toLowerCase().startsWith("en");
  var pageKey = window.location.pathname;

  // ---------- AI 引用 disclaimer (content pages only) ----------
  (function injectDisclaimer() {
    if (document.getElementById("ai-disclaimer")) return;
    var path = window.location.pathname;
    if (path === "/" || path === "/index.html" || path === "/index.en.html") return;
    var seg = path.split("/").filter(Boolean);
    if (seg.length <= 1) return;
    if (seg.length === 2 && (seg[1] === "" || seg[1].indexOf("index") === 0)) return;

    var msg = isEn
      ? "⚠️ Specific citations on this page (quotes, chapters, page numbers, paper claims) are AI-generated and may be inaccurate. Verify before sharing."
      : "⚠️ 本页 AI 生成的具体引用（金句、章节、页码、论文 claim）可能不准确，引用前请验证。";
    var el = document.createElement("div");
    el.id = "ai-disclaimer";
    el.style.cssText =
      "max-width:760px;margin:32px auto 0;padding:12px 16px;font-size:0.82rem;opacity:0.55;text-align:center;border-top:1px dashed rgba(127,127,127,0.4);line-height:1.5";
    el.textContent = msg;
    var footer = document.querySelector("footer");
    if (footer && footer.parentNode) footer.parentNode.insertBefore(el, footer);
    else document.body.appendChild(el);
  })();

  // ---------- Per-tab subscribe (on each repo's landing/index only) ----------
  // Subscribing here tags the email with this tab, so they only get this tab's mail.
  (function injectSubscribe() {
    if (document.getElementById("bigcat-subscribe")) return;
    var segs = window.location.pathname.split("/").filter(Boolean);
    // repo landing = /<repo>/ or /<repo>/index(.en).html ; skip hub root (engage.js owns it)
    var isLanding =
      segs.length === 1 || (segs.length === 2 && segs[1].indexOf("index") === 0);
    if (segs.length === 0 || !isLanding) return;
    var list = segs[0].toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(list)) return;

    var sT = isEn
      ? { head: "📬 Subscribe to this section",
          sub: "New posts in this tab, straight to your inbox. No spam, unsubscribe anytime.",
          ph: "you@example.com", btn: "Subscribe",
          ok: "✓ Subscribed. Thanks!", dup: "✓ You're already subscribed here.",
          pending: "✓ Almost there — check your inbox to confirm.",
          bad: "Please enter a valid email.", net: "Something went wrong — try again." }
      : { head: "📬 订阅这个专栏",
          sub: "这个 tab 有新内容时给你发邮件，只发本专栏。不发垃圾，随时退订。",
          ph: "you@example.com", btn: "订阅",
          ok: "✓ 已订阅，谢谢！", dup: "✓ 你已经订阅过这个专栏啦。",
          pending: "✓ 就差一步——去邮箱点确认链接。",
          bad: "请输入有效的邮箱地址。", net: "出错了，请再试一次。" };

    var css = document.createElement("style");
    css.textContent =
      "#bigcat-subscribe{max-width:760px;margin:48px auto 0;padding:22px 20px;border-top:1px solid rgba(127,127,127,0.22)}" +
      "#bigcat-subscribe h3{font-size:1.02rem;font-weight:600;margin-bottom:5px;letter-spacing:0.5px;opacity:0.85}" +
      "#bigcat-subscribe .bs-sub{font-size:0.83rem;opacity:0.6;margin-bottom:14px}" +
      "#bigcat-subscribe form{display:flex;gap:10px;flex-wrap:wrap}" +
      "#bigcat-subscribe input{flex:1;min-width:180px;padding:10px 13px;border-radius:9px;border:1px solid rgba(127,127,127,0.4);background:rgba(127,127,127,0.08);color:inherit;font-size:0.9rem;font-family:inherit}" +
      "#bigcat-subscribe input:focus{outline:none;border-color:#7b61ff}" +
      "#bigcat-subscribe button{padding:10px 20px;border:none;border-radius:9px;background:linear-gradient(135deg,#7b61ff,#00d4ff);color:#fff;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;transition:opacity .15s}" +
      "#bigcat-subscribe button:hover{opacity:0.88}" +
      "#bigcat-subscribe button:disabled{opacity:0.5;cursor:default}" +
      "#bigcat-subscribe .bs-msg{font-size:0.82rem;margin-top:9px;min-height:16px;color:#00c07a}" +
      "#bigcat-subscribe .bs-msg.err{color:#ff6ec4}";
    document.head.appendChild(css);

    var box = document.createElement("section");
    box.id = "bigcat-subscribe";
    box.innerHTML = "<h3>" + sT.head + "</h3><div class='bs-sub'>" + sT.sub + "</div>";
    var form = document.createElement("form");
    var input = document.createElement("input");
    input.type = "email"; input.placeholder = sT.ph; input.required = true;
    var btn = document.createElement("button");
    btn.type = "submit"; btn.textContent = sT.btn;
    var msg = document.createElement("div"); msg.className = "bs-msg";
    form.appendChild(input); form.appendChild(btn);
    box.appendChild(form); box.appendChild(msg);

    var footer2 = document.querySelector("footer");
    if (footer2 && footer2.parentNode) footer2.parentNode.insertBefore(box, footer2);
    else document.body.appendChild(box);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.className = "bs-msg err"; msg.textContent = sT.bad; return;
      }
      btn.disabled = true; msg.className = "bs-msg"; msg.textContent = "…";
      fetch(API + "/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, list: list, lang: isEn ? "en" : "zh" })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) { msg.className = "bs-msg"; msg.textContent = d.already ? sT.dup : d.pending ? sT.pending : sT.ok; input.value = ""; }
          else { msg.className = "bs-msg err"; msg.textContent = sT.bad; }
        })
        .catch(function () { msg.className = "bs-msg err"; msg.textContent = sT.net; })
        .finally(function () { btn.disabled = false; });
    });
  })();

  // ---------- Comments ----------
  if (document.getElementById("bigcat-comments")) return; // idempotent

  // Detect page luminance so inputs read well on both light and dark pages.
  function pageIsDark() {
    var el = document.body;
    while (el) {
      var c = getComputedStyle(el).backgroundColor;
      if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
        var m = c.match(/\d+(?:\.\d+)?/g);
        if (m && m.length >= 3) {
          return m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114 < 128;
        }
      }
      el = el.parentElement;
    }
    return false;
  }
  var dark = pageIsDark();
  var fieldBg = dark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)";
  var fieldBorder = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.15)";

  var t = isEn
    ? {
        head: "💬 Comments",
        sub: "Log in to comment — your display name is shown, never your email.",
        subIn: "Commenting as ",
        login: "Log in / Sign up",
        bodyPh: "Write a comment…",
        send: "Post",
        empty: "Be the first to comment.",
        ok: "Posted. Thanks!",
        held: "Thanks! Your comment will show after review.",
        err: "Couldn't post — check your comment and try again.",
        rate: "You're posting too fast — wait a moment.",
        needLogin: "Please log in to comment.",
        net: "Network error — try again.",
        loading: "Loading comments…",
      }
    : {
        head: "💬 留言 · Comments",
        sub: "登录后即可留言 —— 只显示你的昵称，不会公开邮箱。",
        subIn: "以此身份留言：",
        login: "登录 / 注册",
        bodyPh: "写下你的留言…",
        send: "发表",
        empty: "还没有留言，来做第一个吧。",
        ok: "已发表，谢谢！",
        held: "谢谢！留言将在审核后显示。",
        err: "发表失败 —— 检查一下内容再试。",
        rate: "发得太快啦，稍等一下。",
        needLogin: "请先登录再留言。",
        net: "网络出错，请重试。",
        loading: "正在加载留言…",
      };

  var css = document.createElement("style");
  css.textContent =
    "#bigcat-comments{max-width:760px;margin:56px auto 24px;padding:28px 20px 8px;border-top:1px solid rgba(127,127,127,0.22)}" +
    "#bigcat-comments h3{font-size:1.05rem;font-weight:600;margin-bottom:6px;letter-spacing:1px;opacity:0.85}" +
    "#bigcat-comments .bc-sub{font-size:0.83rem;opacity:0.55;margin-bottom:16px}" +
    "#bigcat-comments .bc-name{width:100%;max-width:280px;padding:10px 13px;margin-bottom:9px;border-radius:9px;font-size:0.9rem;font-family:inherit;color:inherit;background:" +
    fieldBg + ";border:1px solid " + fieldBorder + "}" +
    "#bigcat-comments textarea{display:block;width:100%;min-height:88px;padding:11px 14px;border-radius:9px;font-size:0.92rem;font-family:inherit;color:inherit;resize:vertical;background:" +
    fieldBg + ";border:1px solid " + fieldBorder + "}" +
    "#bigcat-comments .bc-name:focus,#bigcat-comments textarea:focus{outline:none;border-color:#7b61ff}" +
    "#bigcat-comments .bc-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}" +
    "#bigcat-comments .bc-row{display:flex;align-items:center;gap:12px;margin-top:10px}" +
    "#bigcat-comments button.bc-send{padding:10px 22px;border:none;border-radius:9px;background:linear-gradient(135deg,#7b61ff,#00d4ff);color:#fff;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;transition:opacity 0.15s}" +
    "#bigcat-comments button.bc-send:hover{opacity:0.88}" +
    "#bigcat-comments button.bc-send:disabled{opacity:0.5;cursor:default}" +
    "#bigcat-comments .bc-msg{font-size:0.83rem;min-height:18px;color:#00c07a}" +
    "#bigcat-comments .bc-msg.err{color:#ff6ec4}" +
    "#bigcat-comments .bc-list{margin-top:26px;display:flex;flex-direction:column;gap:16px}" +
    "#bigcat-comments .bc-item{padding:13px 16px;border-radius:10px;background:rgba(127,127,127,0.06);border:1px solid rgba(127,127,127,0.14)}" +
    "#bigcat-comments .bc-meta{font-size:0.78rem;opacity:0.6;margin-bottom:5px}" +
    "#bigcat-comments .bc-meta b{font-weight:700;opacity:0.9}" +
    "#bigcat-comments .bc-body{font-size:0.92rem;line-height:1.6;white-space:pre-wrap;word-break:break-word}" +
    "#bigcat-comments .bc-empty{font-size:0.86rem;opacity:0.5;padding:8px 0}";
  document.head.appendChild(css);

  var box = document.createElement("section");
  box.id = "bigcat-comments";
  var h = document.createElement("h3");
  h.textContent = t.head;
  var sub = document.createElement("div");
  sub.className = "bc-sub";
  sub.textContent = t.sub;
  box.appendChild(h);
  box.appendChild(sub);

  // form
  var form = document.createElement("form");
  form.style.position = "relative";
  // Login gate: posting needs an account, and the name shown comes from that
  // account (the server ignores any client-supplied name), so there's no name
  // field here any more. Reading comments stays open to everyone.
  var SESSION_KEY = "bigcat-session";
  function session() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; }
  }
  function loginUrl() {
    return (isEn ? "/account.en.html" : "/account.html") +
      "?next=" + encodeURIComponent(location.pathname + location.search);
  }
  var loginBtn = document.createElement("a");
  loginBtn.className = "bc-send";
  loginBtn.style.cssText = "display:inline-block;text-decoration:none;margin-bottom:9px";
  loginBtn.textContent = t.login;
  loginBtn.href = loginUrl();
  var ta = document.createElement("textarea");
  ta.placeholder = t.bodyPh;
  ta.maxLength = 2000;
  ta.required = true;
  // honeypot — hidden from humans, tempting to bots
  var hp = document.createElement("input");
  hp.type = "text";
  hp.className = "bc-hp";
  hp.tabIndex = -1;
  hp.setAttribute("autocomplete", "off");
  hp.setAttribute("aria-hidden", "true");
  hp.name = "website";
  var row = document.createElement("div");
  row.className = "bc-row";
  var send = document.createElement("button");
  send.type = "submit";
  send.className = "bc-send";
  send.textContent = t.send;
  var msg = document.createElement("div");
  msg.className = "bc-msg";
  row.appendChild(send);
  row.appendChild(msg);
  form.appendChild(ta);
  form.appendChild(hp);
  form.appendChild(row);
  box.appendChild(form);

  // Resolve the logged-in account: show "commenting as <name>" and enable the
  // form, or swap in a login button. Comments below stay visible either way.
  function applyAuthState(name) {
    if (name) {
      sub.textContent = t.subIn + name;
      if (loginBtn.parentNode) loginBtn.remove();
      ta.disabled = false;
      send.disabled = false;
      form.style.display = "";
    } else {
      sub.textContent = t.sub;
      ta.disabled = true;
      send.disabled = true;
      if (!loginBtn.parentNode) box.insertBefore(loginBtn, form);
      form.style.display = "none";
    }
  }
  applyAuthState(null); // default to locked until /auth-me answers
  if (session()) {
    fetch(API + "/auth-me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: session() }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) applyAuthState(d.name || d.email);
        else { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
      })
      .catch(function () {});
  }

  // optional Turnstile widget
  var tsToken = "";
  if (TURNSTILE_SITEKEY) {
    var tsDiv = document.createElement("div");
    tsDiv.style.marginTop = "10px";
    tsDiv.className = "cf-turnstile";
    tsDiv.setAttribute("data-sitekey", TURNSTILE_SITEKEY);
    tsDiv.setAttribute("data-callback", "__bcTsCb");
    tsDiv.setAttribute("data-theme", "dark");
    window.__bcTsCb = function (tok) {
      tsToken = tok;
    };
    form.insertBefore(tsDiv, row);
    var tsScript = document.createElement("script");
    tsScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    tsScript.async = true;
    tsScript.defer = true;
    document.head.appendChild(tsScript);
  }

  var list = document.createElement("div");
  list.className = "bc-list";
  var loadingEl = document.createElement("div");
  loadingEl.className = "bc-empty";
  loadingEl.textContent = t.loading;
  list.appendChild(loadingEl);
  box.appendChild(list);

  // mount before footer
  var footer = document.querySelector("footer");
  if (footer && footer.parentNode) footer.parentNode.insertBefore(box, footer);
  else document.body.appendChild(box);

  function fmt(ts) {
    try {
      return new Date(ts).toLocaleString(isEn ? "en-US" : "zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function renderItem(c) {
    var item = document.createElement("div");
    item.className = "bc-item";
    var meta = document.createElement("div");
    meta.className = "bc-meta";
    var b = document.createElement("b");
    b.textContent = c.name; // textContent = safe
    meta.appendChild(b);
    meta.appendChild(document.createTextNode(" · " + fmt(c.ts)));
    var body = document.createElement("div");
    body.className = "bc-body";
    body.textContent = c.body; // textContent = safe, no HTML injection
    item.appendChild(meta);
    item.appendChild(body);
    return item;
  }

  function renderList(comments) {
    list.innerHTML = "";
    if (!comments || !comments.length) {
      var e = document.createElement("div");
      e.className = "bc-empty";
      e.textContent = t.empty;
      list.appendChild(e);
      return;
    }
    comments.forEach(function (c) {
      list.appendChild(renderItem(c));
    });
  }

  function load() {
    fetch(API + "/comments?page=" + encodeURIComponent(pageKey))
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d.ok) renderList(d.comments);
        else renderList([]);
      })
      .catch(function () {
        list.innerHTML = "";
      });
  }
  load();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = ta.value.trim();
    if (!text) return;
    send.disabled = true;
    msg.className = "bc-msg";
    msg.textContent = "…";
    fetch(API + "/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: pageKey,
        body: text,
        session: session(), // server derives the displayed name from this
        website: hp.value, // honeypot
        token: tsToken,
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d;
        if (d.ok) {
          msg.className = "bc-msg";
          if (d.approved && d.comment) {
            var empty = list.querySelector(".bc-empty");
            if (empty) empty.remove();
            list.appendChild(renderItem(d.comment));
            msg.textContent = t.ok;
          } else {
            msg.textContent = t.held;
          }
          ta.value = "";
        } else if (res.status === 429) {
          msg.className = "bc-msg err";
          msg.textContent = t.rate;
        } else if (res.status === 401 || d.error === "login_required") {
          // Session expired or revoked mid-visit — fall back to the login gate.
          try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
          applyAuthState(null);
          msg.className = "bc-msg err";
          msg.textContent = t.needLogin;
        } else {
          msg.className = "bc-msg err";
          msg.textContent = t.err;
        }
      })
      .catch(function () {
        msg.className = "bc-msg err";
        msg.textContent = t.net;
      })
      .finally(function () {
        send.disabled = false;
      });
  });
})();
