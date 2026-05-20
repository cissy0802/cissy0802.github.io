#!/usr/bin/env python3
"""Regenerate index.html for the BigCat Learning Hub.

Fetches each repo's last content-commit date via `gh` CLI, then renders the hub.
Run from repo root: python3 generate_hub.py
"""

import datetime
import json
import subprocess
from pathlib import Path

# Each card: (accent_class, emoji, title_zh, subtitle_en, desc, repo, section)
CARDS = [
    # Daily
    ("mental",     "📚", "每日思维模型",   "Mental Models Daily · Daily 3:00am",   "决策、认知、系统思维、博弈、概率、心理学——每天 3-4 个模型，构建跨学科心智工具箱。",                    "mental-models-daily",         "daily"),
    ("aiml",       "🤖", "每日 AI / ML",   "AI & ML Daily · Daily 3:05am",         "LLM、Agent、RAG、强化学习、多模态、可解释性——深入技术原理，构建 AI 超级个体能力。",                "ai-ml-daily",                 "daily"),
    ("meta",       "🧠", "每日元知识",     "Meta Knowledge Daily · Daily 3:10am",  "神经科学、行为经济学、复杂系统、社会学、管理学、量子物理——跨学科的世界模型工具箱。",                "meta-knowledge-daily",        "daily"),
    # Bi-daily
    ("book",       "📖", "隔日好书推荐",   "Book Recommendations · Tue/Thu/Fri 3:15am", "每期一本书的深度推荐——金句、思想谱系、阅读策略、限制与争议，覆盖商业、科学、文学、哲学。",             "book-recommendations-bidaily","bidaily"),
    ("sysd",       "🏗️", "隔日 System Design","System Design · Wed/Fri/Sat 3:20am",   "分布式系统、架构 trade-off、真实案例拆解、面试题示范——给资深工程师的 system design 训练。",          "system-design-bidaily",       "bidaily"),
    # Weekly
    ("health",     "🫀", "每周健康长寿",   "Health & Longevity · Mon 3:25am",     "循证医学、长寿科学、女性健康、运动营养睡眠——可执行的健康协议，不是养生鸡汤。",                       "health-longevity-weekly",     "weekly"),
    ("history",    "🏛️", "每周历史大事件", "History · Mon 3:30am",                 "冷战转折、技术史、商业史、地缘政治——具体事件与反事实思考，Munger 的最佳教材。",                       "history-weekly",              "weekly"),
    ("parenting",  "👶", "每周育儿与教育", "Parenting · Tue 3:35am",               "循证育儿、儿童脑科学、AI 时代教育——具体话术与场景，妈妈视角。",                                       "parenting-weekly",            "weekly"),
    ("writing",    "✍️", "每周写作与表达", "Writing · Wed 3:40am",                 "Zinsser、Orwell、金字塔原理、备忘录、AI 时代写作——超级个体的表达工具箱。",                            "writing-weekly",              "weekly"),
    ("bio",        "👩‍💼", "每周人物传记", "Biographies · Thu 3:45am",            "领导者、科学家、思想家、女性领袖——关键决策、生涯转折、争议与阴面，深度学习一个人。",                  "biographies-weekly",          "weekly"),
    ("philosophy", "📜", "每周哲学经典",   "Philosophy · Sat 3:50am",              "东西方哲学经典，从柏拉图到庄子，从康德到王阳明，跨越时空的思想对话。",                                   "philosophy-weekly",           "weekly"),
    ("buddhism",   "🪷", "每周佛经",       "Buddhism · Sun 3:55am",                "经藏智慧，般若、中观、唯识、禅宗、华严、净土，每周四部经典，闻思修行。",                                 "buddhism-weekly",             "weekly"),
    ("investing",  "📈", "每周投资经典",   "Investing · Sun 4:00am",               "Buffett、Munger、Howard Marks、Klarman、Damodaran——投资决策思维的深度训练。",                          "investing-weekly",            "weekly"),
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
    "writing":    ("#1f1f1f", "#6a6a6a"),
    "bio":        ("#d4af37", "#f4e3a1"),
    "philosophy": ("#a29bfe", "#6c5ce7"),
    "buddhism":   ("#b8956a", "#8a6d3b"),
    "investing":  ("#b8893a", "#7a5c1f"),
}


def latest_content_date(repo: str) -> str:
    """Return YYYY-MM-DD of the latest commit that touched a content html
    (a *-day*.html / *-week*.html / *-book*.html file, not index.html).
    Falls back to repo's most recent commit if no content commit found."""
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/cissy0802/{repo}/commits?per_page=50"],
            stderr=subprocess.DEVNULL,
        )
        commits = json.loads(out)
    except subprocess.CalledProcessError:
        return ""
    for c in commits:
        sha = c["sha"]
        try:
            files_out = subprocess.check_output(
                ["gh", "api", f"repos/cissy0802/{repo}/commits/{sha}"],
                stderr=subprocess.DEVNULL,
            )
            files = json.loads(files_out).get("files", [])
        except subprocess.CalledProcessError:
            continue
        for f in files:
            name = f["filename"]
            if name == "index.html" or name == "README.md" or name == "generate.py":
                continue
            if name.endswith(".html"):
                return c["commit"]["committer"]["date"][:10]
    if commits:
        return commits[0]["commit"]["committer"]["date"][:10]
    return ""


def card_css() -> str:
    lines = []
    for key, (accent, grad) in CSS_VARS.items():
        if grad.startswith("linear-gradient"):
            bg = grad
        else:
            bg = f"linear-gradient(90deg,{accent},{grad})"
        lines.append(f".card.{key}{{--accent:{accent}}}")
        lines.append(f".card.{key}::before{{background:{bg}}}")
    return "\n".join(lines)


def card_html(c, date_str: str) -> str:
    accent_class, emoji, title, subtitle, desc, repo, _section = c
    return f"""  <a class="card {accent_class}" href="https://cissy0802.github.io/{repo}/">
    <span class="emoji">{emoji}</span>
    <div class="title">{title}</div>
    <div class="subtitle-en">{subtitle}</div>
    <div class="desc">{desc}</div>
    <div class="meta-row">
      <span class="updated">Updated: {date_str or "—"}</span>
      <span class="arrow">进入 →</span>
    </div>
  </a>"""


def section(label_en: str, label_zh: str, cards_html: list[str]) -> str:
    body = "\n\n".join(cards_html)
    return f'  <div class="section-label">// {label_en} — {label_zh}</div>\n\n{body}'


def main():
    print("Fetching last update dates...")
    dates = {}
    for c in CARDS:
        repo = c[5]
        dates[repo] = latest_content_date(repo)
        print(f"  {repo}: {dates[repo] or 'N/A'}")

    today = datetime.date.today().strftime("%Y-%m-%d")

    daily = [card_html(c, dates[c[5]]) for c in CARDS if c[6] == "daily"]
    bidaily = [card_html(c, dates[c[5]]) for c in CARDS if c[6] == "bidaily"]
    weekly = [card_html(c, dates[c[5]]) for c in CARDS if c[6] == "weekly"]

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
.container{{max-width:920px;margin:0 auto;padding:48px 24px 80px}}
header{{text-align:center;padding:48px 0 56px}}
header h1{{font-size:2.6rem;font-weight:800;background:linear-gradient(135deg,#00d4ff 0%,#7b61ff 50%,#ff6ec4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;margin-bottom:12px}}
header .tagline{{font-size:1.1rem;color:#a0a8c0;font-weight:300;letter-spacing:1px}}
header .subtitle{{font-size:0.85rem;color:#7b61ff;margin-top:8px;font-family:"SF Mono",Menlo,monospace}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;margin-top:24px}}
.card{{display:flex;flex-direction:column;padding:24px 24px 20px;background:rgba(255,255,255,0.04);backdrop-filter:blur(10px);border-radius:16px;border:1px solid rgba(255,255,255,0.08);text-decoration:none;color:inherit;transition:all 0.25s ease;position:relative;overflow:hidden}}
.card::before{{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent);opacity:0.8}}
.card:hover{{transform:translateY(-4px);background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.15);box-shadow:0 12px 32px rgba(0,0,0,0.4)}}
.card .emoji{{font-size:2rem;margin-bottom:10px;display:block}}
.card .title{{font-size:1.25rem;font-weight:700;margin-bottom:4px;color:#fff}}
.card .subtitle-en{{font-size:0.78rem;color:#8b92a8;font-family:"SF Mono",Menlo,monospace;margin-bottom:12px;letter-spacing:0.3px}}
.card .desc{{font-size:0.92rem;color:#c0c6d4;line-height:1.6;flex:1}}
.card .meta-row{{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)}}
.card .updated{{font-size:0.72rem;color:#6a7080;font-family:"SF Mono",Menlo,monospace;letter-spacing:0.3px}}
.card .arrow{{font-size:0.85rem;color:var(--accent);font-weight:600;transition:transform 0.2s}}
.card:hover .arrow{{transform:translateX(4px)}}
{card_css()}
.section-label{{grid-column:1/-1;font-size:0.85rem;color:#7b61ff;letter-spacing:2px;text-transform:uppercase;margin-top:24px;margin-bottom:-4px;font-family:"SF Mono",Menlo,monospace}}
.section-label:first-of-type{{margin-top:0}}
footer{{text-align:center;padding:56px 0 12px;font-size:0.78rem;color:#5a6378}}
footer a{{color:#7b61ff;text-decoration:none}}
footer a:hover{{color:#00d4ff}}
@media(max-width:600px){{
  header h1{{font-size:1.8rem}}
  .container{{padding:32px 18px 60px}}
  .grid{{grid-template-columns:1fr}}
}}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>BigCat's Learning Hub</h1>
  <div class="tagline">每日学习 · 跨界思考 · 超级个体</div>
  <div class="subtitle">&gt; All times in PDT · curated by AI · auto-published to GitHub Pages</div>
</header>

<div class="grid">
{grid}
</div>

<footer>
  BigCat · {today} · <a href="https://github.com/cissy0802">GitHub</a> · regenerated via <code>generate_hub.py</code>
</footer>
</div>
</body>
</html>
"""
    Path("index.html").write_text(html, encoding="utf-8")
    print(f"\nWritten index.html ({len(html)} bytes)")


if __name__ == "__main__":
    main()
