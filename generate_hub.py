#!/usr/bin/env python3
"""Regenerate index.html for the BigCat Learning Hub.

Fetches each repo's latest commit date via the GitHub REST API, then renders
the hub. Run from repo root:  python3 generate_hub.py

In CI, set GITHUB_TOKEN env var to raise rate limit (5000/hr instead of 60/hr).
"""

import datetime
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

# Matches content files: *-day1.html, *-week1.html, *-book1.html,
# or older date-based pattern *-YYYY-MM-DD.html (mental-models legacy).
CONTENT_RE = re.compile(r'-(day|week|book)\d+\.html$|-\d{4}-\d{2}-\d{2}\.html$')

# (accent_class, emoji, title_zh, subtitle_en, desc, repo, section)
CARDS = [
    # 思维 · Thinking
    ("mental",     "📚", "思维模型",       "Mental Models",         "决策、认知、系统思维、博弈、概率、心理学——每天 3-4 个模型，构建跨学科心智工具箱。",                    "mental-models-daily",         "thinking"),
    ("meta",       "🧠", "元知识",         "Meta Knowledge",        "神经科学、行为经济学、复杂系统、社会学、管理学、量子物理——跨学科的世界模型工具箱。",                "meta-knowledge-daily",        "thinking"),
    # 技术 · Tech
    ("super",      "⚡", "AI 超级个体实战", "Super Individual",     "AI 工具栈、Prompt 库、PKM、自动化、Agent——AI 时代个人生产力的战术手册。",                                "super-individual-weekly",     "tech"),
    ("aiml",       "🤖", "AI / ML",        "AI & ML",               "LLM、Agent、RAG、强化学习、多模态、可解释性——深入技术原理，构建 AI 超级个体能力。",                "ai-ml-daily",                 "tech"),
    ("sysd",       "🏗️", "System Design",  "System Design",         "分布式系统、架构 trade-off、真实案例拆解、面试题示范——给资深工程师的 system design 训练。",          "system-design-bidaily",       "tech"),
    # 职场 · Career
    ("leadership", "🎯", "领导力实践",     "Leadership",            "1:1、反馈、难对话、招聘、coaching——具体话术与检查表，技术 leader 的处方性 craft。",                       "leadership-weekly",           "career"),
    ("writing",    "✍️", "写作与表达",     "Writing",               "Zinsser、Orwell、金字塔原理、备忘录、AI 时代写作——超级个体的表达工具箱。",                            "writing-weekly",              "career"),
    # 生活 · Life
    ("health",     "🫀", "健康长寿",       "Health & Longevity",    "循证医学、长寿科学、女性健康、运动营养睡眠——可执行的健康协议，不是养生鸡汤。",                       "health-longevity-weekly",     "life"),
    ("parenting",  "👶", "育儿与教育",     "Parenting",             "循证育儿、儿童脑科学、AI 时代教育——具体话术与场景，妈妈视角。",                                       "parenting-weekly",            "life"),
    ("psych",      "🧩", "心理学",         "Psychology",            "人格、依恋、创伤、认知、治疗——理解自己与他人的内在世界。",                                             "psychology-weekly",           "life"),
    ("family",     "🧺", "一起做",         "Doing Together",        "烹饪、园艺、小实验、手工、自然观察——和孩子一起动手的日常实践，每期分龄三段。",                         "family-craft-weekly",         "life"),
    # 人文 · Humanities
    ("philosophy", "📜", "哲学经典",       "Philosophy",            "东西方哲学经典，从柏拉图到庄子，从康德到王阳明，跨越时空的思想对话。",                                   "philosophy-weekly",           "humanities"),
    ("buddhism",   "🪷", "佛经",           "Buddhism",              "经藏智慧，般若、中观、唯识、禅宗、华严、净土，四部经典，闻思修行。",                                     "buddhism-weekly",             "humanities"),
    ("art",        "🎨", "艺术与审美",     "Art & Aesthetics",      "看画、听乐、读影、赏建筑——怎么看怎么听的感受力训练，东西方兼顾。",                                       "art-aesthetics-weekly",       "humanities"),
    ("bio",        "👩‍💼", "人物传记",     "Biographies",           "领导者、科学家、思想家、女性领袖——关键决策、生涯转折、争议与阴面，深度学习一个人。",                  "biographies-weekly",          "humanities"),
    ("book",       "📖", "好书推荐",       "Book Recommendations",  "每期 4 本同主题相关好书——思想脉络、阅读顺序、金句与争议，覆盖商业、科学、文学、哲学。",                 "book-recommendations-bidaily","humanities"),
    # 探索 · Explore
    ("math",       "📐", "数学之美",       "Mathematics",           "概率、微积分、线代、拓扑、信息论——数学之美与跨学科的优雅工具。",                                       "mathematics-weekly",          "explore"),
    ("history",    "🏛️", "历史大事件",     "History",               "冷战转折、技术史、商业史、地缘政治——具体事件与反事实思考，Munger 的最佳教材。",                       "history-weekly",              "explore"),
    ("investing",  "📈", "投资经典",       "Investing",             "Buffett、Munger、Howard Marks、Klarman、Damodaran——投资决策思维的深度训练。",                          "investing-weekly",            "explore"),
    ("civics",     "🌍", "政治·法律·地缘", "Civics & Geopolitics",  "制度、法律、国际关系、地缘——中立、多视角、不站队的世界运作框架。",                                       "civics-geopolitics-weekly",   "explore"),
]

# BigCat's Thinking Hub —— 互动型思想实验，链到自建静态站(非每日内容仓库，故无 commit 日期)。
# (accent_class, emoji, title_zh, subtitle_en, desc, href, badge)
THINKING_CARDS = [
    ("thinker", "⚖️", "思想家圆桌辩论", "Thinker Roundtable",
     "古今中外 70+ 位思想家就一个问题数轮辩论，立场表态、古文白话，最后 Claude / GPT / Gemini 三家 AI 收尾。",
     "https://cissy0802.github.io/thinker-arena/", "圆桌"),
]

CSS_VARS = {
    "mental":     ("#00d4ff", "#0096c7"),
    "aiml":       ("#ff6ec4", "#7b61ff"),
    "meta":       ("#52b788", "linear-gradient(90deg,#e85a4f,#f7a072,#52b788,#3a86ff)"),
    "book":       ("#a87a3e", "#6b4423"),
    "sysd":       ("#64c8ff", "#5eead4"),
    "health":     ("#3aa17e", "#0d6e6e"),
    "history":    ("#a35d2b", "#5a3a1e"),
    "parenting":  ("#e07a9b", "#c45a8e"),
    "writing":    ("#e8e4d8", "#a8a294"),
    "bio":        ("#d4af37", "#f4e3a1"),
    "philosophy": ("#a29bfe", "#6c5ce7"),
    "buddhism":   ("#b8956a", "#8a6d3b"),
    "investing":  ("#b8893a", "#7a5c1f"),
    "super":      ("#ff6ec4", "linear-gradient(90deg,#ff6ec4,#7b61ff,#00d4ff)"),
    "leadership": ("#a8702d", "#5c3a18"),
    "psych":      ("#a85aa8", "#7a3e8c"),
    "math":       ("#3a6088", "#1e3a5f"),
    "art":        ("#e76f51", "#9b2d30"),
    "civics":     ("#6ea8d8", "#1f3a5f"),
    "family":     ("#ffd166", "#e8743b"),
    "thinker":    ("#a29bfe", "linear-gradient(90deg,#a29bfe,#7b61ff,#ff6ec4)"),
}


def gh_get(url: str):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "bigcat-hub-generator",
    })
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def latest_commit_date(repo: str) -> str:
    """YYYY-MM-DD of the latest commit that added/modified a content file
    (matches CONTENT_RE), ignoring index.html, README, workflows, generator.

    Falls back to the repo's most recent commit if no content commit found
    in the last 50 commits.
    """
    try:
        commits = gh_get(f"https://api.github.com/repos/cissy0802/{repo}/commits?per_page=50")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  WARN {repo}: {e}")
        return ""
    if not commits:
        return ""
    for c in commits:
        sha = c["sha"]
        try:
            detail = gh_get(f"https://api.github.com/repos/cissy0802/{repo}/commits/{sha}")
        except (urllib.error.URLError, urllib.error.HTTPError):
            continue
        for f in detail.get("files", []):
            name = f.get("filename", "")
            status = f.get("status", "")
            # Only count commits that ADD a new content file (not edits to existing ones).
            if status == "added" and CONTENT_RE.search(name):
                return c["commit"]["committer"]["date"][:10]
    return commits[0]["commit"]["committer"]["date"][:10]


def card_css() -> str:
    lines = []
    for key, (accent, grad) in CSS_VARS.items():
        bg = grad if grad.startswith("linear-gradient") else f"linear-gradient(90deg,{accent},{grad})"
        lines.append(f".card.{key}{{--accent:{accent}}}")
        lines.append(f".card.{key}::before{{background:{bg}}}")
    return "\n".join(lines)


def card_html(c, date_str: str) -> str:
    accent_class, emoji, title, subtitle, desc, repo, _section = c
    return f"""  <a class="card {accent_class}" href="https://cissy0802.github.io/{repo}/">
    <span class="emoji">{emoji}</span>
    <div class="body">
      <div class="title-row"><span class="title">{title}</span><span class="subtitle-en">{subtitle}</span></div>
      <div class="desc">{desc}</div>
    </div>
    <div class="meta">
      <span class="updated">{date_str or "—"}</span>
      <span class="arrow">进入 →</span>
    </div>
  </a>"""


def thinking_card_html(c) -> str:
    accent_class, emoji, title, subtitle, desc, href, badge = c
    return f"""  <a class="card {accent_class}" href="{href}">
    <span class="emoji">{emoji}</span>
    <div class="body">
      <div class="title-row"><span class="title">{title}</span><span class="subtitle-en">{subtitle}</span></div>
      <div class="desc">{desc}</div>
    </div>
    <div class="meta">
      <span class="updated">{badge}</span>
      <span class="arrow">进入 →</span>
    </div>
  </a>"""


def section(label_en: str, label_zh: str, cards_html: list[str]) -> str:
    body = "\n\n".join(cards_html)
    return f'  <div class="section-label">// {label_zh} · {label_en}</div>\n\n{body}'


def main():
    print("Fetching last commit dates...")
    dates = {}
    for c in CARDS:
        repo = c[5]
        dates[repo] = latest_commit_date(repo)
        print(f"  {repo}: {dates[repo] or 'N/A'}")

    today = datetime.date.today().strftime("%Y-%m-%d")

    def cards_for(sec): return [card_html(c, dates[c[5]]) for c in CARDS if c[6] == sec]

    grid = "\n\n".join([
        section("Thinking",   "思维",     cards_for("thinking")),
        section("Tech",       "技术",     cards_for("tech")),
        section("Career",     "职场",     cards_for("career")),
        section("Life",       "生活",     cards_for("life")),
        section("Humanities", "人文",     cards_for("humanities")),
        section("Explore",    "探索",     cards_for("explore")),
    ])

    thinking_grid = "\n\n".join(thinking_card_html(c) for c in THINKING_CARDS)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BigCat's Learning Hub</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,"SF Pro Display","Noto Serif SC","Songti SC",sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0a0e1a 100%);color:#e4e6eb;line-height:1.7;min-height:100vh}}
.container{{max-width:980px;margin:0 auto;padding:48px 24px 80px}}
header{{text-align:center;padding:48px 0 48px}}
header h1{{font-size:2.6rem;font-weight:800;background:linear-gradient(135deg,#00d4ff 0%,#7b61ff 50%,#ff6ec4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;margin-bottom:12px}}
header .tagline{{font-size:1.1rem;color:#a0a8c0;font-weight:300;letter-spacing:1px}}
header .subtitle{{font-size:0.85rem;color:#7b61ff;margin-top:8px;font-family:"SF Mono",Menlo,monospace}}
.lang-toggle{{position:fixed;top:18px;right:18px;background:rgba(255,255,255,0.06);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:5px;display:flex;gap:0;z-index:100;font-family:"SF Mono",Menlo,monospace;font-size:0.78rem}}
.lang-toggle a{{padding:5px 12px;border-radius:14px;color:#a0a8c0;text-decoration:none;transition:all 0.15s}}
.lang-toggle a.active{{background:#7b61ff;color:#fff;font-weight:700}}
.lang-toggle a:not(.active):hover{{background:rgba(255,255,255,0.08);color:#fff}}
.list{{display:flex;flex-direction:column;gap:10px;margin-top:24px}}
.card{{display:grid;grid-template-columns:auto 1fr auto;gap:22px;align-items:center;padding:16px 22px;background:rgba(255,255,255,0.04);backdrop-filter:blur(10px);border-radius:12px;border:1px solid rgba(255,255,255,0.08);text-decoration:none;color:inherit;transition:all 0.2s ease;position:relative;overflow:hidden}}
.card::before{{content:"";position:absolute;top:0;left:0;bottom:0;width:4px;background:var(--accent);opacity:0.85}}
.card:hover{{transform:translateX(3px);background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.15);box-shadow:0 4px 16px rgba(0,0,0,0.3)}}
.card .emoji{{font-size:1.7rem;flex-shrink:0;padding-left:6px}}
.card .body{{min-width:0;overflow:hidden}}
.card .title-row{{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:3px}}
.card .title{{font-size:1.1rem;font-weight:700;color:#fff}}
.card .subtitle-en{{font-size:0.74rem;color:#7b61ff;font-family:"SF Mono",Menlo,monospace;letter-spacing:0.3px;opacity:0.85}}
.card .desc{{font-size:0.88rem;color:#a8b0c0;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.card .meta{{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;font-family:"SF Mono",Menlo,monospace}}
.card .updated{{font-size:0.72rem;color:#6a7080;letter-spacing:0.3px}}
.card .arrow{{font-size:0.78rem;color:var(--accent);font-weight:600;transition:transform 0.2s}}
.card:hover .arrow{{transform:translateX(3px)}}
{card_css()}
.section-label{{font-size:0.78rem;color:#7b61ff;letter-spacing:2px;text-transform:uppercase;margin-top:24px;margin-bottom:2px;font-family:"SF Mono",Menlo,monospace;opacity:0.75}}
.section-label:first-of-type{{margin-top:8px}}
.hub2-header{{text-align:center;margin:60px 0 6px}}
.hub2-header h2{{font-size:1.9rem;font-weight:800;letter-spacing:1.5px;background:linear-gradient(135deg,#a29bfe 0%,#7b61ff 50%,#ff6ec4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px}}
.hub2-header .hub2-tag{{font-size:0.95rem;color:#a0a8c0;font-weight:300;letter-spacing:0.5px}}
.search-prompt{{margin:24px auto 0;max-width:520px;text-align:center;padding:14px 18px;background:rgba(255,255,255,0.04);border:1px solid rgba(123,97,255,0.25);border-radius:10px;font-size:0.88rem;color:#a0a8c0;font-family:"SF Mono",Menlo,monospace}}
.search-prompt kbd{{background:rgba(123,97,255,0.25);color:#fff;padding:2px 8px;border-radius:5px;font-family:inherit;font-size:0.85rem}}
footer{{text-align:center;padding:48px 0 12px;font-size:0.78rem;color:#5a6378}}
footer a{{color:#7b61ff;text-decoration:none}}
footer a:hover{{color:#00d4ff}}
@media(max-width:700px){{
  header h1{{font-size:1.8rem}}
  .container{{padding:32px 16px 60px}}
  .card{{grid-template-columns:auto 1fr;gap:14px;padding:14px 18px}}
  .card .meta{{display:none}}
  .card .desc{{white-space:normal;font-size:0.85rem}}
  .lang-toggle{{top:10px;right:10px}}
}}
</style>
</head>
<body>
<div class="lang-toggle">
  <a href="index.html" class="active">中文</a>
  <a href="index.en.html">EN</a>
</div>
<div class="container">
<header>
  <h1>BigCat's Learning Hub</h1>
  <div class="tagline">每日学习 · 跨界思考 · 超级个体</div>
  <div class="search-prompt">🔍 按 <kbd>/</kbd> 或点击右下角搜索全站</div>
</header>

<div class="list">
{grid}
</div>

<div class="hub2-header">
  <h2>BigCat's Thinking Hub</h2>
  <div class="hub2-tag">让思想家替你思考 · 互动圆桌</div>
</div>

<div class="list">
{thinking_grid}
</div>

<footer>
  BigCat · refreshed {today} · <a href="https://github.com/cissy0802">GitHub</a> · auto-regenerated
</footer>
</div>
<script src="/search.js" defer></script>
</body>
</html>
"""
    Path("index.html").write_text(html, encoding="utf-8")
    print(f"\nWritten index.html ({len(html)} bytes)")


if __name__ == "__main__":
    main()
