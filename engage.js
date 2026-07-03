/* BigCat Learning Hub — engagement widget (email subscribe + poll + comments).
 *
 * Self-contained section injected on the hub landing page only.
 *   • Email subscribe  -> POST {API}/subscribe   (Cloudflare Worker + D1)
 *   • Poll / voting     -> GET/POST {API}/poll,/vote
 *   • Comments          -> Giscus (GitHub Discussions), same repo as comments.js
 *
 * After deploying the Worker, set API below to your workers.dev URL (no trailing slash).
 */
(function () {
  // ======= CONFIG ===========================================================
  var API = "https://bigcat-engage.cissychen.workers.dev"; // <-- set after deploy

  // The poll shown on the hub. Edit freely; `id` is the storage key.
  var POLL = {
    id: "next-focus-2026",
    q_zh: "接下来你最想我多更新哪个方向？",
    q_en: "Which area should I publish more on next?",
    options: [
      { key: "thinking", zh: "思维 · 心智模型", en: "Thinking · Mental models" },
      { key: "tech", zh: "技术 · AI/ML", en: "Tech · AI/ML" },
      { key: "humanities", zh: "人文 · 哲学/历史", en: "Humanities · Philosophy/History" },
      { key: "life", zh: "生活 · 健康/育儿", en: "Life · Health/Parenting" },
    ],
  };
  // ==========================================================================

  // Only run on the hub landing page.
  var path = window.location.pathname;
  var isLanding =
    path === "/" || path === "/index.html" || path === "/index.en.html";
  if (!isLanding) return;
  if (document.getElementById("engage-widget")) return; // idempotent

  var isEn = (document.documentElement.lang || "").toLowerCase().startsWith("en");
  var t = isEn
    ? {
        subHead: "📬 Subscribe",
        subSub: "Get an email when new pieces go up. No spam, unsubscribe anytime.",
        subPlaceholder: "you@example.com",
        subBtn: "Subscribe",
        subOk: "✓ You're on the list. Thanks!",
        subDup: "✓ You're already subscribed.",
        subErr: "Please enter a valid email.",
        subNet: "Something went wrong — try again.",
        pollHead: "🗳️ Vote",
        voted: "Thanks for voting!",
        votes: "votes",
      }
    : {
        subHead: "📬 邮件订阅",
        subSub: "有新内容时给你发一封邮件。不发垃圾，随时退订。",
        subPlaceholder: "you@example.com",
        subBtn: "订阅",
        subOk: "✓ 已加入订阅，谢谢！",
        subDup: "✓ 你已经订阅过啦。",
        subErr: "请输入有效的邮箱地址。",
        subNet: "出错了，请再试一次。",
        pollHead: "🗳️ 投票",
        voted: "谢谢你的投票！",
        votes: "票",
      };

  // Stable anonymous voter id (localStorage).
  var voter = localStorage.getItem("bigcat_voter");
  if (!voter) {
    voter = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("bigcat_voter", voter);
  }

  // ---------- styles ----------
  var css = document.createElement("style");
  css.textContent =
    "#engage-widget{max-width:760px;margin:8px auto 0;padding:8px 4px 0}" +
    "#engage-widget .eg-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:22px 24px;margin-top:16px;backdrop-filter:blur(10px)}" +
    "#engage-widget h3{font-size:1.02rem;font-weight:700;color:#fff;letter-spacing:1px;margin-bottom:6px}" +
    "#engage-widget .eg-sub{font-size:0.85rem;color:#a8b0c0;margin-bottom:16px;line-height:1.5}" +
    "#engage-widget form{display:flex;gap:10px;flex-wrap:wrap}" +
    "#engage-widget input[type=email]{flex:1;min-width:180px;padding:11px 14px;border-radius:9px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);color:#e4e6eb;font-size:0.92rem;font-family:inherit}" +
    "#engage-widget input[type=email]:focus{outline:none;border-color:#7b61ff}" +
    "#engage-widget button.eg-btn{padding:11px 22px;border:none;border-radius:9px;background:linear-gradient(135deg,#7b61ff,#00d4ff);color:#fff;font-weight:700;font-size:0.92rem;cursor:pointer;transition:opacity 0.15s;font-family:inherit}" +
    "#engage-widget button.eg-btn:hover{opacity:0.88}" +
    "#engage-widget button.eg-btn:disabled{opacity:0.5;cursor:default}" +
    "#engage-widget .eg-msg{font-size:0.83rem;margin-top:10px;min-height:18px;color:#00d4ff}" +
    "#engage-widget .eg-msg.err{color:#ff6ec4}" +
    "#engage-widget .eg-opt{display:block;width:100%;text-align:left;margin-top:9px;padding:12px 15px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.2);color:#e4e6eb;font-size:0.9rem;cursor:pointer;position:relative;overflow:hidden;transition:border-color 0.15s;font-family:inherit}" +
    "#engage-widget .eg-opt:hover{border-color:rgba(123,97,255,0.6)}" +
    "#engage-widget .eg-opt .eg-bar{position:absolute;left:0;top:0;bottom:0;background:rgba(123,97,255,0.22);width:0;transition:width 0.5s ease;z-index:0}" +
    "#engage-widget .eg-opt .eg-lbl,#engage-widget .eg-opt .eg-pct{position:relative;z-index:1}" +
    "#engage-widget .eg-opt .eg-pct{float:right;font-family:'SF Mono',Menlo,monospace;font-size:0.82rem;color:#a0a8c0}" +
    "#engage-widget .eg-opt.mine{border-color:#7b61ff}" +
    "#engage-widget .eg-total{font-size:0.76rem;color:#6a7080;margin-top:12px;font-family:'SF Mono',Menlo,monospace}";
  document.head.appendChild(css);

  // ---------- container ----------
  var wrap = document.createElement("section");
  wrap.id = "engage-widget";

  // ----- subscribe card -----
  var subCard = document.createElement("div");
  subCard.className = "eg-card";
  subCard.innerHTML =
    "<h3>" + t.subHead + "</h3><div class='eg-sub'>" + t.subSub + "</div>";
  var form = document.createElement("form");
  var input = document.createElement("input");
  input.type = "email";
  input.placeholder = t.subPlaceholder;
  input.required = true;
  var subBtn = document.createElement("button");
  subBtn.type = "submit";
  subBtn.className = "eg-btn";
  subBtn.textContent = t.subBtn;
  form.appendChild(input);
  form.appendChild(subBtn);
  var subMsg = document.createElement("div");
  subMsg.className = "eg-msg";
  subCard.appendChild(form);
  subCard.appendChild(subMsg);
  wrap.appendChild(subCard);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      subMsg.className = "eg-msg err";
      subMsg.textContent = t.subErr;
      return;
    }
    subBtn.disabled = true;
    subMsg.className = "eg-msg";
    subMsg.textContent = "…";
    fetch(API + "/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, list: "hub" }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d.ok) {
          subMsg.className = "eg-msg";
          subMsg.textContent = d.already ? t.subDup : t.subOk;
          input.value = "";
        } else {
          subMsg.className = "eg-msg err";
          subMsg.textContent = t.subErr;
        }
      })
      .catch(function () {
        subMsg.className = "eg-msg err";
        subMsg.textContent = t.subNet;
      })
      .finally(function () {
        subBtn.disabled = false;
      });
  });

  // ----- poll card -----
  var pollCard = document.createElement("div");
  pollCard.className = "eg-card";
  pollCard.innerHTML =
    "<h3>" + t.pollHead + "</h3><div class='eg-sub'>" +
    (isEn ? POLL.q_en : POLL.q_zh) + "</div>";
  var optEls = {};
  POLL.options.forEach(function (o) {
    var b = document.createElement("button");
    b.className = "eg-opt";
    b.dataset.key = o.key;
    b.innerHTML =
      "<span class='eg-bar'></span>" +
      "<span class='eg-lbl'>" + (isEn ? o.en : o.zh) + "</span>" +
      "<span class='eg-pct'></span>";
    b.addEventListener("click", function () {
      castVote(o.key);
    });
    pollCard.appendChild(b);
    optEls[o.key] = b;
  });
  var total = document.createElement("div");
  total.className = "eg-total";
  pollCard.appendChild(total);
  wrap.appendChild(pollCard);

  function renderTally(tally, mine) {
    var sum = 0;
    Object.keys(tally).forEach(function (k) {
      sum += tally[k];
    });
    POLL.options.forEach(function (o) {
      var n = tally[o.key] || 0;
      var pct = sum ? Math.round((n / sum) * 100) : 0;
      var el = optEls[o.key];
      el.querySelector(".eg-bar").style.width = pct + "%";
      el.querySelector(".eg-pct").textContent =
        sum ? pct + "% · " + n + " " + t.votes : "";
      el.classList.toggle("mine", mine === o.key);
    });
    total.textContent =
      sum + " " + t.votes + (mine ? " · " + t.voted : "");
  }

  function loadTally() {
    fetch(API + "/poll?id=" + encodeURIComponent(POLL.id) + "&voter=" + encodeURIComponent(voter))
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d.ok) renderTally(d.tally || {}, d.mine);
      })
      .catch(function () {});
  }

  function castVote(choice) {
    fetch(API + "/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poll: POLL.id, choice: choice, voter: voter }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d.ok) renderTally(d.tally || {}, choice);
      })
      .catch(function () {});
  }
  loadTally();

  // Comments are handled by comments.js (login-free custom backend), which
  // mounts its own section on this page too — nothing to do here.

  // ---------- mount before footer ----------
  var footer = document.querySelector("footer");
  if (footer && footer.parentNode) {
    footer.parentNode.insertBefore(wrap, footer);
  } else {
    document.body.appendChild(wrap);
  }
})();
