#!/usr/bin/env python3
"""Render static, Pagefind-crawlable snapshots of the Thinking Hub (thinker-arena).

The live Thinking Hub renders each debate client-side from JSON (debate.html + app.js),
so a static crawler like Pagefind sees an empty scaffold and indexes nothing. This
script reads the debate JSON and emits one HTML snapshot per debate per language into
<arena>/search/, each carrying a Pagefind URL override that points back at the live
interactive debate page. The build-search workflow runs this before Pagefind so that
Thinking Hub roundtable debates show up in the Learning Hub's site-wide search.

Notes:
- We deliberately do NOT use data-pagefind-body: that attribute is a *global* switch
  that would make Pagefind index only pages that have it, excluding every routine-repo
  page. Routine pages rely on default full-page indexing, so we leave that untouched.
- The result URL is overridden via a hidden <span data-pagefind-meta="url[content]">.
  The override is root-relative (/thinker-arena/...) so it (a) resolves correctly on
  cissy0802.github.io and (b) does not contain the substring 'cissy0802.github.io/'
  that build-search's exclude-selectors strip from indexed content.
- One snapshot per language (zh -> <id>.html, en -> <id>.en.html) with the matching
  <html lang>, so each lands in the correct Pagefind language index — mirroring how the
  hub ships index.html (zh) and index.en.html (en).

Usage: python3 render_search_snapshots.py [path-to-thinker-arena]   (default _src/thinker-arena)
"""
import html
import json
import sys
from pathlib import Path

ARENA = Path(sys.argv[1] if len(sys.argv) > 1 else "_src/thinker-arena")
OUT = ARENA / "search"
LIVE = "/thinker-arena/debate.html?id={id}"  # root-relative -> resolves on hub origin


def esc(s):
    return html.escape(s or "")


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def render(d, thinkers, en):
    """Return an HTML snapshot string for one debate in one language, or None if the
    debate has no content in that language."""
    did = d["id"]
    q = d.get("question_en") if en else d.get("question")
    if not q:
        return None

    def nm(tid):
        t = thinkers.get(tid, {})
        return (t.get("name_en") if en else t.get("name")) or tid

    sep = ", " if en else "、"
    names = sep.join(nm(p) for p in d.get("participants", []))

    parts = []
    for post in d.get("posts", []):
        txt = post.get("text_en") if en else post.get("text")
        if not txt:
            continue
        who = nm(post.get("thinker"))
        parts.append(f"<p><strong>{esc(who)}:</strong> {esc(txt)}</p>")

    for s in d.get("summaries", []):
        keys = ("summary_en", "insight_en", "advice_en") if en else ("summary", "insight", "advice")
        for k in keys:
            v = s.get(k)
            if v:
                parts.append(f"<p>{esc(v)}</p>")

    if not parts:
        return None

    lang_attr = "en" if en else "zh-CN"
    label = "Roundtable Debate" if en else "圆桌辩论"
    parts_label = "Participants" if en else "参与者"
    body = "\n".join(parts)
    return f"""<!DOCTYPE html>
<html lang="{lang_attr}">
<head>
<meta charset="UTF-8">
<title>{esc(q)} — {label}</title>
</head>
<body>
<span data-pagefind-meta="url[content]" content="{LIVE.format(id=did)}" hidden></span>
<article>
<h1>{esc(q)}</h1>
<p>{label} · {parts_label}: {esc(names)}</p>
{body}
</article>
</body>
</html>
"""


def main():
    thinkers = {t["id"]: t for t in load(ARENA / "thinkers.json")["thinkers"]}
    index = load(ARENA / "debates" / "index.json")["debates"]
    OUT.mkdir(parents=True, exist_ok=True)

    n = 0
    for meta in index:
        did = meta["id"]
        dpath = ARENA / "debates" / f"{did}.json"
        if not dpath.exists():
            print(f"  skip {did}: {dpath} missing")
            continue
        d = load(dpath)
        for en in (False, True):
            page = render(d, thinkers, en)
            if not page:
                continue
            fn = f"{did}.en.html" if en else f"{did}.html"
            (OUT / fn).write_text(page, encoding="utf-8")
            n += 1
    print(f"Rendered {n} Thinking Hub search snapshots into {OUT}")


if __name__ == "__main__":
    main()
