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
    # Daily
    ("mental",     "📚", "每日思维模型",   "Mental Models Daily",   "决策、认知、系统思维、博弈、概率、心理学——每天 3-4 个模型，构建跨学科心智工具箱。",                    "mental-models-daily",         "daily"),
    ("aiml",       "🤖", "每日 AI / ML",   "AI & ML Daily",         "LLM、Agent、RAG、强化学习、多模态、可解释性——深入技术原理，构建 AI 超级个体能力。",                "ai-ml-daily",                 "daily"),
    ("meta",       "🧠", "每日元知识",     "Meta Knowledge Daily",  "神经科学、行为经济学、复杂系统、社会学、管理学、量子物理——跨学科的世界模型工具箱。",                "meta-knowledge-daily",        "daily"),
    # Bi-daily
    ("book",       "📖", "隔日好书推荐",   "Book Recommendations · Tue/Thu/Fri", "每期一本书的深度推荐——金句、思想谱系、阅读策略、限制与争议，覆盖商业、科学、文学、哲学。",             "book-recommendations-bidaily","bidaily"),
    ("sysd",       "🏗️", "隔日 System Design","System Design · Wed/Fri/Sat",   "分布式系统、架构 trade-off、真实案例拆解、面试题示范——给资深工程师的 system design 训练。",          "system-design-bidaily",       "bidaily"),
    # Weekly
    ("health",     "🫀", "每周健康长寿",   "Health & Longevity · Mon",     "循证医学、长寿科学、女性健康、运动营养睡眠——可执行的健康协议，不是养生鸡汤。",                       "health-longevity-weekly",     "weekly"),
    ("history",    "🏛️", "每周历史大事件", "History · Mon",                 "冷战转折、技术史、商业史、地缘政治——具体事件与反事实思考，Munger 的最佳教材。",                       "history-weekly",              "weekly"),
    ("parenting",  "👶", "每周育儿与教育", "Parenting · Tue",               "循证育儿、儿童脑科学、AI 时代教育——具体话术与场景，妈妈视角。",                                       "parenting-weekly",            "weekly"),
    ("writing",    "✍️", "每周写作与表达", "Writing · Wed",                 "Zinsser、Orwell、金字塔原理、备忘录、AI 时代写作——超级个体的表达工具箱。",                            "writing-weekly",              "weekly"),
    ("bio",        "👩‍💼", "每周人物传记", "Biographies · Thu",            "领导者、科学家、思想家、女性领袖——关键决策、生涯转折、争议与阴面，深度学习一个人。",                  "biographies-weekly",          "weekly"),
    ("philosophy", "📜", "每周哲学经典",   "Philosophy · Sat",              "东西方哲学经典，从柏拉图到庄子，从康德到王阳明，跨越时空的思想对话。",                                   "philosophy-weekly",           "weekly"),
    ("buddhism",   "🪷", "每周佛经",       "Buddhism · Sun",                "经藏智慧，般若、中观、唯识、禅宗、华严、净土，每周四部经典，闻思修行。",                                 "buddhism-weekly",             "weekly"),
    ("investing",  "📈", "每周投资经典",   "Investing · Sun",               "Buffett、Munger、Howard Marks、Klarman、Damodaran——投资决策思维的深度训练。",                          "investing-weekly",            "weekly"),
    ("super",      "⚡", "AI 超级个体实战", "Super Individual · Tue",        "AI 工具栈、Prompt 库、PKM、自动化、Agent——AI 时代个人生产力的战术手册。",                                "super-individual-weekly",     "weekly"),
    ("leadership", "🎯", "每周领导力实践", "Leadership · Wed",              "1:1、反馈、难对话、招聘、coaching——具体话术与检查表，技术 leader 的处方性 craft。",                       "leadership-weekly",           "weekly"),
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


def section(label_en: str, label_zh: str, cards_html: list[str]) -> str:
    body = "\n\n".join(cards_html)
    return f'  <div class="section-label">// {label_en} — {label_zh}</div>\n\n{body}'


def main():
    print("Fetching last commit dates...")
    dates = {}
    for c in CARDS:
        repo = c[5]
        dates[repo] = latest_commit_date(repo)
        print(f"  {repo}: {dates[repo] or 'N/A'}")

    today = datetime.date.today().strftime("%Y-%m-%d")

    daily   = [card_html(c, dates[c[5]]) for c in CARDS if c[6] == "daily"]
    bidaily = [card_html(c, dates[c[5]]) for c in CARDS if c[6] == "bidaily"]
    weekly  = [card_html(c, dates[c[5]]) for c in CARDS if c[6] == "weekly"]

    grid = "\n\n".join([
        section("Daily", "每日", daily),
        section("Bi-daily", "隔日", bidaily),
        section("Weekly", "每周", weekly),
    ])

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
}}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>BigCat's Learning Hub</h1>
  <div class="tagline">每日学习 · 跨界思考 · 超级个体</div>
  <div class="search-prompt">🔍 按 <kbd>/</kbd> 或点击右下角搜索全站</div>
</header>

<div class="list">
{grid}
</div>

<footer>
  BigCat · refreshed {today} · <a href="https://github.com/cissy0802">GitHub</a> · auto-regenerated daily
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
