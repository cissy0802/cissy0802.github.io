#!/usr/bin/env python3
"""Regenerate index.html (中文) AND index.en.html (English) for the BigCat Learning Hub.

Fetches each repo's latest commit date via the GitHub REST API, then renders BOTH
language versions from a single source of truth (CARDS below carry both desc_zh and
desc_en). Run from repo root:  python3 generate_hub.py

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
CONTENT_RE = re.compile(r'-(day|week|book|topic)\d+\.html$|-\d{4}-\d{2}-\d{2}\.html$')

# (accent_class, emoji, title_zh, subtitle_en, desc_zh, desc_en, repo, section)
CARDS = [
    # 思维 · Thinking
    ("mental", "📚", "思维模型", "Mental Models",
     "决策、认知、系统思维、博弈、概率、心理学——每天 3-4 个模型，构建跨学科心智工具箱。",
     "Decision, cognition, systems thinking, game theory, probability, psychology — 3-4 models per day to build a cross-disciplinary toolkit.",
     "mental-models", "thinking"),
    ("meta", "🧠", "元知识", "Meta Knowledge",
     "神经科学、行为经济学、复杂系统、社会学、管理学、量子物理——跨学科的世界模型工具箱。",
     "Neuroscience, behavioral economics, complex systems, sociology, management, quantum physics — a cross-disciplinary world-model toolkit.",
     "meta-knowledge", "thinking"),
    # 技术 · Tech
    ("super", "⚡", "AI 超级个体实战", "Super Individual",
     "AI 工具栈、Prompt 库、PKM、自动化、Agent——AI 时代个人生产力的战术手册。",
     "AI tool stack, prompt library, PKM, automation, agents — a tactical handbook for personal productivity in the AI era.",
     "super-individual", "tech"),
    ("aiml", "🤖", "AI / ML", "AI & ML",
     "LLM、Agent、RAG、强化学习、多模态、可解释性——深入技术原理，构建 AI 超级个体能力。",
     "LLMs, agents, RAG, reinforcement learning, multimodal, interpretability — deep technical principles to build super-individual AI capabilities.",
     "ai-ml", "tech"),
    ("sysd", "🏗️", "System Design", "System Design",
     "分布式系统、架构 trade-off、真实案例拆解、面试题示范——给资深工程师的 system design 训练。",
     "Distributed systems, architecture trade-offs, real-world case studies, interview demos — system design training for senior engineers.",
     "system-design", "tech"),
    ("papers", "📄", "IT 论文精读", "CS Papers",
     "计算机 / AI 里程碑论文精读——问题、核心思想、方法、影响一次讲透，配自绘示意图，读这页≈读懂论文。",
     "Milestone CS/AI papers, distilled — the problem, key idea, method and impact in one read, with hand-drawn diagrams; read this page instead of the paper.",
     "cs-papers-deepread", "tech"),
    # 职场 · Career
    ("leadership", "🎯", "领导力实践", "Leadership",
     "1:1、反馈、难对话、招聘、coaching——具体话术与检查表，技术 leader 的处方性 craft。",
     "1:1s, feedback, hard conversations, hiring, coaching — concrete scripts and checklists; prescriptive craft for tech leaders.",
     "leadership", "career"),
    ("writing", "✍️", "写作与表达", "Writing",
     "Zinsser、Orwell、金字塔原理、备忘录、AI 时代写作——超级个体的表达工具箱。",
     "Zinsser, Orwell, Pyramid Principle, memos, writing in the AI era — the super-individual's expression toolkit.",
     "writing", "career"),
    # 生活 · Life
    ("health", "🫀", "健康长寿", "Health & Longevity",
     "循证医学、长寿科学、女性健康、运动营养睡眠——可执行的健康协议，不是养生鸡汤。",
     "Evidence-based medicine, longevity science, women's health, exercise, nutrition, sleep — actionable protocols, not wellness fluff.",
     "health-longevity", "life"),
    ("parenting", "👶", "育儿与教育", "Parenting",
     "循证育儿、儿童脑科学、AI 时代教育——具体话术与场景，妈妈视角。",
     "Evidence-based parenting, child neuroscience, education for the AI era — concrete scripts and scenarios from a mother's perspective.",
     "parenting", "life"),
    ("psych", "🧩", "心理学", "Psychology",
     "人格、依恋、创伤、认知、治疗——理解自己与他人的内在世界。",
     "Personality, attachment, trauma, cognition, therapy — understanding the inner world of yourself and others.",
     "psychology", "life"),
    ("family", "🧺", "一起做", "Doing Together",
     "烹饪、园艺、小实验、手工、自然观察——和孩子一起动手的日常实践，每期分龄三段。",
     "Cooking, gardening, kitchen science, crafts — hands-on family practice with the kids, age-tiered and sibling-friendly.",
     "family-craft", "life"),
    ("finance", "💵", "个人理财", "Personal Finance",
     "现金流、税、保险、买房、退休、股权薪酬——管好守住规划自己的钱，可执行不清谈、不荐股。",
     "Cash flow, tax, insurance, housing, retirement, equity comp — manage, protect and plan your own money; actionable, no stock picks.",
     "personal-finance", "life"),
    # 人文 · Humanities
    ("philosophy", "📜", "哲学经典", "Philosophy",
     "东西方哲学经典，从柏拉图到庄子，从康德到王阳明，跨越时空的思想对话。",
     "Eastern and Western classics, from Plato to Zhuangzi, Kant to Wang Yangming — a dialogue of ideas across time and space.",
     "philosophy", "humanities"),
    ("buddhism", "🪷", "佛经", "Buddhism",
     "经藏智慧，般若、中观、唯识、禅宗、华严、净土，四部经典，闻思修行。",
     "Wisdom from the Tripitaka — Prajna, Madhyamaka, Yogacara, Chan, Huayan, Pure Land — four classics per issue, hearing, reflection, practice.",
     "buddhism", "humanities"),
    ("religions", "🕊️", "世界宗教", "World Religions",
     "犹太教、基督教、伊斯兰、印度教、道教…每期一个传统，讲清历史、分布、信仰体系与信徒实践——中立比较，不传教（佛学见佛经站）。",
     "Judaism, Christianity, Islam, Hinduism, Daoism… one tradition per issue — history, distribution, beliefs and practice; neutral and comparative (Buddhism lives in its own site).",
     "world-religions", "humanities"),
    ("art", "🎨", "艺术与审美", "Art & Aesthetics",
     "看画、听乐、读影、赏建筑——怎么看怎么听的感受力训练，东西方兼顾。",
     "How to look at paintings, listen to music, read film, appreciate architecture — training perception, East and West in balance.",
     "art-aesthetics", "humanities"),
    ("bio", "👩‍💼", "人物传记", "Biographies",
     "领导者、科学家、思想家、女性领袖——关键决策、生涯转折、争议与阴面，深度学习一个人。",
     "Leaders, scientists, thinkers, women leaders — key decisions, career turning points, controversies and shadow sides; deep study of one person.",
     "biographies", "humanities"),
    ("book", "📖", "好书推荐", "Book Recommendations",
     "每期 4 本同主题相关好书——思想脉络、阅读顺序、金句与争议，覆盖商业、科学、文学、哲学。",
     "4 thematically linked books per issue — intellectual lineage, reading order, key quotes and controversies; business, science, literature, philosophy.",
     "book-recommendations", "humanities"),
    ("deepread", "📰", "好书精读", "Deep Reading",
     "每天精读一本好书——把它反复在讲的几个核心概念彻底讲透，读完这页≈读完原书。",
     "One book a day, read closely — the few core concepts it keeps circling, made clear; read this page instead of the whole book.",
     "deep-reading", "humanities"),
    # 探索 · Explore
    ("math", "📐", "数学之美", "Mathematics",
     "概率、微积分、线代、拓扑、信息论——数学之美与跨学科的优雅工具。",
     "Probability, calculus, linear algebra, topology, information theory — the beauty of mathematics and elegant cross-disciplinary tools.",
     "mathematics", "science"),
    ("history", "🏛️", "历史大事件", "History",
     "冷战转折、技术史、商业史、地缘政治——具体事件与反事实思考，Munger 的最佳教材。",
     "Cold War turning points, history of technology, business history, geopolitics — specific events and counterfactual thinking, Munger's favorite textbook.",
     "history", "explore"),
    ("investing", "📈", "投资经典", "Investing",
     "Buffett、Munger、Howard Marks、Klarman、Damodaran——投资决策思维的深度训练。",
     "Buffett, Munger, Howard Marks, Klarman, Damodaran — deep training in investment decision thinking.",
     "investing", "explore"),
    ("civics", "🌍", "政治·法律·地缘", "Civics & Geopolitics",
     "制度、法律、国际关系、地缘——中立、多视角、不站队的世界运作框架。",
     "Institutions, law, international relations, geography of power — how the world is governed and divided, neutral and multi-perspective.",
     "civics-geopolitics", "explore"),
    ("neuro", "🧠", "神经科学", "Neuroscience",
     "脑作为物理+计算系统的机制层——认知与意识优先，AI 对读贯穿每一期。",
     "The brain as a physical & computational system — cognition and consciousness first, with an AI cross-read running through every topic.",
     "neuroscience", "science"),
]

# BigCat's Thinking Hub —— 互动型思想实验，链到自建静态站(非每日内容仓库，故无 commit 日期)。
# (accent_class, emoji, title_zh, subtitle_en, desc_zh, desc_en, href, badge_zh, badge_en)
THINKING_CARDS = [
    ("thinker", "⚖️", "思想家圆桌辩论", "Thinker Roundtable",
     "古今中外 100+ 位思想家就一个问题数轮辩论，立场表态、古文白话，最后 Claude / GPT / Gemini 三家 AI 收尾。",
     "100+ thinkers across eras and traditions debate one question over several rounds — taking sides, classical texts glossed in plain language, closed by a three-way Claude / GPT / Gemini AI panel.",
     "https://cissy0802.github.io/thinker-arena/", "圆桌", "Roundtable"),
]

# Deep Research —— 多 agent 调研 + 对抗式核查的研究报告站(独立静态站,非每日 routine)。
# Tuple shape identical to THINKING_CARDS.
RESEARCH_CARDS = [
    ("research", "🔬", "深度研究", "Deep Research",
     "多 agent 调研 + 对抗式事实核查的研究报告——每篇易读版 + 深入版。",
     "Multi-agent research with adversarial fact-checking — plain and deep editions.",
     "https://cissy0802.github.io/deep-research/", "研究", "Research"),
]

CSS_VARS = {
    "mental":     ("#00d4ff", "#0096c7"),
    "aiml":       ("#ff6ec4", "#7b61ff"),
    "meta":       ("#52b788", "linear-gradient(90deg,#e85a4f,#f7a072,#52b788,#3a86ff)"),
    "book":       ("#a87a3e", "#6b4423"),
    "deepread":   ("#3f8b7f", "#2f5d57"),
    "sysd":       ("#64c8ff", "#5eead4"),
    "papers":     ("#f0b429", "#e8794b"),
    "health":     ("#3aa17e", "#0d6e6e"),
    "history":    ("#a35d2b", "#5a3a1e"),
    "parenting":  ("#e07a9b", "#c45a8e"),
    "writing":    ("#e8e4d8", "#a8a294"),
    "bio":        ("#d4af37", "#f4e3a1"),
    "philosophy": ("#a29bfe", "#6c5ce7"),
    "buddhism":   ("#b8956a", "#8a6d3b"),
    "investing":  ("#b8893a", "#7a5c1f"),
    "finance":    ("#0f766e", "#0b5850"),
    "super":      ("#ff6ec4", "linear-gradient(90deg,#ff6ec4,#7b61ff,#00d4ff)"),
    "leadership": ("#a8702d", "#5c3a18"),
    "psych":      ("#a85aa8", "#7a3e8c"),
    "math":       ("#3a6088", "#1e3a5f"),
    "art":        ("#e76f51", "#9b2d30"),
    "civics":     ("#6ea8d8", "#1f3a5f"),
    "neuro":      ("#a78bfa", "#e879f9"),
    "family":     ("#ffd166", "#e8743b"),
    "thinker":    ("#a29bfe", "linear-gradient(90deg,#a29bfe,#7b61ff,#ff6ec4)"),
    "research":   ("#4cc9f0", "linear-gradient(90deg,#4cc9f0,#7b61ff)"),
}

# Per-language chrome strings.
I18N = {
    "zh": {
        "html_lang": "zh-CN",
        "tagline": "每日学习 · 跨界思考 · 超级个体",
        "search_prompt": '🔍 按 <kbd>/</kbd> 或点击右下角搜索全站',
        "arrow": "进入 →",
        "toggle": '<a href="index.html" class="active">中文</a>\n  <a href="index.en.html">EN</a>',
        "blog": '<a href="blog-pipeline.html">🛠 这个 Hub 是怎么搭的</a>',
        "about": '关于作者：BigCat，Staff 技术 / AI 工程师',
    },
    "en": {
        "html_lang": "en",
        "tagline": "Daily learning · Cross-domain thinking · Super-individual",
        "search_prompt": '🔍 Press <kbd>/</kbd> or click the search button (bottom right) to search the whole site',
        "arrow": "enter →",
        "toggle": '<a href="index.html">中文</a>\n  <a href="index.en.html" class="active">EN</a>',
        "blog": '<a href="blog-pipeline.en.html">🛠 how this hub is built</a>',
        "about": 'About the builder: BigCat, staff tech / AI engineer',
    },
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


# Dynamic cap: TOPICS.md is the single source of truth. A routine is "已完结 / Completed"
# once it has published up to the highest Day in its TOPICS.md — no static cap numbers
# to keep in sync. Add new TOPICS (e.g. back-fed from deep-research) and the badge
# automatically un-marks; the routine reopens. Mirrors the verify-routine-caps task.
def roadmap_max(repo: str):
    """Highest planned Day/Week/Issue number in the repo's TOPICS.md list items, or None
    (no TOPICS.md, or a non-numbered curated list like the paper/book roadmaps)."""
    try:
        req = urllib.request.Request(
            f"https://raw.githubusercontent.com/cissy0802/{repo}/main/TOPICS.md",
            headers={"User-Agent": "bigcat-hub-generator"})
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "replace")
    except (urllib.error.URLError, urllib.error.HTTPError):
        return None
    # only line-leading list items (matches the verify-caps regex) — avoids inline
    # prose mentions like "已在 Day 4/22 覆盖" inflating the max.
    nums = [int(m) for m in re.findall(r"(?im)^[-*#]*\s*(?:day|week|issue|topic)\s*(\d+)", text)]
    return max(nums) if nums else None


def latest_commit_date(repo: str):
    """Return (date, is_done). date = YYYY-MM-DD of the latest commit that added a
    content file (matches CONTENT_RE). is_done = True when the highest published 'Add #N'
    has caught up to the repo's TOPICS.md roadmap (roadmap_max). Falls back to newest commit date."""
    try:
        commits = gh_get(f"https://api.github.com/repos/cissy0802/{repo}/commits?per_page=50")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  WARN {repo}: {e}")
        return "", False
    if not commits:
        return "", False
    # done: published caught up to the dynamic cap = highest Day in TOPICS.md.
    pub_nums = [int(n) for c in commits for n in re.findall(r"Add #(\d+)", c["commit"]["message"])]
    pub = max(pub_nums) if pub_nums else 0
    tmax = roadmap_max(repo)
    done = tmax is not None and pub >= tmax
    # date: latest commit that ADDED a content file (fallback: newest commit)
    for c in commits:
        try:
            detail = gh_get(f"https://api.github.com/repos/cissy0802/{repo}/commits/{c['sha']}")
        except (urllib.error.URLError, urllib.error.HTTPError):
            continue
        for f in detail.get("files", []):
            if f.get("status") == "added" and CONTENT_RE.search(f.get("filename", "")):
                return c["commit"]["committer"]["date"][:10], done
    return commits[0]["commit"]["committer"]["date"][:10], done


def card_css() -> str:
    lines = []
    for key, (accent, grad) in CSS_VARS.items():
        bg = grad if grad.startswith("linear-gradient") else f"linear-gradient(90deg,{accent},{grad})"
        lines.append(f".card.{key}{{--accent:{accent}}}")
        lines.append(f".card.{key}::before{{background:{bg}}}")
    return "\n".join(lines)


def _amp(s: str) -> str:
    return s.replace("&", "&amp;")


def card_html(c, meta, lang: str) -> str:
    accent_class, emoji, title_zh, subtitle_en, desc_zh, desc_en, repo, _section = c
    date_str, done = meta
    base = f"https://cissy0802.github.io/{repo}/"
    if lang == "zh":
        href = base
        title_row = f'<span class="title">{title_zh}</span><span class="subtitle-en">{_amp(subtitle_en)}</span>'
        desc = desc_zh
    else:
        href = base + "index.en.html"
        title_row = f'<span class="title">{_amp(subtitle_en)}</span>'
        desc = desc_en
    return f"""  <a class="card {accent_class}" href="{href}">
    <span class="emoji">{emoji}</span>
    <div class="body">
      <div class="title-row">{title_row}</div>
      <div class="desc">{desc}</div>
    </div>
    <div class="meta">
      {'<span class="updated" style="color:#3fb955;font-weight:600" title="收口完结">✓ ' + ('已完结' if lang == 'zh' else 'Completed') + '</span>' if done else f'<span class="updated">{date_str or "—"}</span>'}
      <span class="arrow">{I18N[lang]["arrow"]}</span>
    </div>
  </a>"""


def thinking_card_html(c, lang: str) -> str:
    accent_class, emoji, title_zh, subtitle_en, desc_zh, desc_en, href, badge_zh, badge_en = c
    if lang == "zh":
        title_row = f'<span class="title">{title_zh}</span><span class="subtitle-en">{_amp(subtitle_en)}</span>'
        desc, badge = desc_zh, badge_zh
    else:
        title_row = f'<span class="title">{_amp(subtitle_en)}</span>'
        desc, badge = desc_en, badge_en
        # English page lives at index.en.html (same split-file convention as the
        # other sites); zh stays at the bare dir (index.html).
        href = href + "index.en.html"
    return f"""  <a class="card {accent_class}" href="{href}">
    <span class="emoji">{emoji}</span>
    <div class="body">
      <div class="title-row">{title_row}</div>
      <div class="desc">{desc}</div>
    </div>
    <div class="meta">
      <span class="updated">{badge}</span>
      <span class="arrow">{I18N[lang]["arrow"]}</span>
    </div>
  </a>"""


def section(label_en: str, label_zh: str, cards_html: list[str], lang: str) -> str:
    body = "\n\n".join(cards_html)
    label = f"{label_zh} · {label_en}" if lang == "zh" else label_en
    return f'  <div class="section-label">// {label}</div>\n\n{body}'


def group_label(label_zh: str, label_en: str, lang: str) -> str:
    label = f"{label_zh} · {label_en}" if lang == "zh" else label_en
    return f'  <div class="group-label">{label}</div>'


def render_page(lang: str, grid: str, today: str) -> str:
    t = I18N[lang]
    return f"""<!DOCTYPE html>
<html lang="{t['html_lang']}">
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
.group-label{{font-size:1.02rem;font-weight:700;color:#b9a8ff;letter-spacing:2.5px;text-transform:uppercase;margin-top:42px;margin-bottom:6px;font-family:"SF Mono",Menlo,monospace}}
.group-label:first-of-type{{margin-top:12px}}
.section-label{{font-size:0.78rem;color:#7b61ff;letter-spacing:2px;text-transform:uppercase;margin-top:24px;margin-bottom:2px;font-family:"SF Mono",Menlo,monospace;opacity:0.75}}
.section-label:first-of-type{{margin-top:6px}}
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
  {t['toggle']}
</div>
<div class="container">
<header>
  <h1>BigCat's Learning Hub</h1>
  <div class="tagline">{t['tagline']}</div>
  <div class="search-prompt">{t['search_prompt']}</div>
</header>

<div class="list">
{grid}
</div>

<footer>
  {t['blog']}<br>
  {t['about']}<br>
  BigCat · refreshed {today} · <a href="https://github.com/cissy0802">GitHub</a> · <a href="mailto:cissy@cissychen.com">cissy@cissychen.com</a>
</footer>
</div>
<script src="/search.js" defer></script>
<script src="/engage.js" defer></script>
<script src="/comments.js" defer></script>
</body>
</html>
"""


def main():
    print("Fetching last commit dates...")
    dates = {}
    for c in CARDS:
        repo = c[6]
        dates[repo] = latest_commit_date(repo)
        _d, _done = dates[repo]
        print(f"  {repo}: {_d or 'N/A'}{' [已完结]' if _done else ''}")

    today = datetime.date.today().strftime("%Y-%m-%d")

    for lang, fname in (("zh", "index.html"), ("en", "index.en.html")):
        def cards_for(sec):
            return [card_html(c, dates[c[6]], lang) for c in CARDS if c[7] == sec]
        thinking_cards = "\n\n".join(thinking_card_html(c, lang) for c in THINKING_CARDS)
        research_cards = "\n\n".join(thinking_card_html(c, lang) for c in RESEARCH_CARDS)
        brain = "\n\n".join([
            section("Thinking",   "思维",     cards_for("thinking"), lang),
            section("Tech",       "技术",     cards_for("tech"), lang),
            section("Career",     "职场",     cards_for("career"), lang),
            section("Life",       "生活",     cards_for("life"), lang),
            section("Humanities", "人文",     cards_for("humanities"), lang),
            section("Science",    "科学",     cards_for("science"), lang),
            section("Explore",    "探索",     cards_for("explore"), lang),
        ])
        grid = "\n\n".join([
            group_label("思想圆桌", "Thinking Hub", lang) + "\n\n" + thinking_cards,
            group_label("深度研究", "Deep Research", lang) + "\n\n" + research_cards,
            group_label("第二大脑", "Second Brain", lang) + "\n\n" + brain,
        ])
        html = render_page(lang, grid, today)
        Path(fname).write_text(html, encoding="utf-8")
        print(f"Written {fname} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
