#!/usr/bin/env python3
"""Turn the aggregated HTML in _src into a clean Markdown corpus for AI Search.

Why not point AI Search at the HTML directly (it accepts .html): these pages are
~110 divs of layout around ~9 paragraphs of prose, plus a nav and a comments
widget on every one. Indexed raw, a good share of every chunk is furniture, and
chunk boundaries land in markup rather than between ideas. Stripping to prose
first is the cheapest quality win available, and it costs one pass.

Keys mirror the site's own paths — corpus/philosophy/foo-day40.md is the page at
hub.cissychen.com/philosophy/foo-day40.html — so the filename AI Search cites in
an answer maps straight back to a link. The canonical URL is written into the
front matter too, for the cases where it can't be derived (Thinking Hub debates
render client-side; their crawlable snapshots carry the live URL in a meta tag).

    ./export-corpus.py _src corpus/
"""
import html
import os
import re
import sys

SITE = "https://hub.cissychen.com"

# Whole elements whose text is furniture, not content.
DROP_ELEMENTS = re.compile(
    r"<(script|style|nav|footer|noscript)\b[^>]*>.*?</\1\s*>", re.S | re.I
)
DROP_COMMENTS_WIDGET = re.compile(
    r'<div[^>]*id="bigcat-comments".*?</div>\s*(?=<(?:/body|script|div))', re.S | re.I
)
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)

TITLE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
CANONICAL = re.compile(r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"', re.I)
# The debate snapshots' Pagefind URL override, e.g.
# <span data-pagefind-meta="url[content]" content="/thinker-arena/debate.html?id=x" hidden>
META_URL = re.compile(
    r'<span[^>]+data-pagefind-meta="url\[content\]"[^>]+content="([^"]+)"', re.I
)
LANG = re.compile(r'<html[^>]+lang="([^"]+)"', re.I)

# Block-level tags become paragraph breaks so chunks split between ideas.
BLOCK = re.compile(
    r"</(p|div|section|article|header|li|tr|h[1-6]|blockquote|figcaption)\s*>", re.I
)
HEADING = re.compile(r"<h([1-3])\b[^>]*>(.*?)</h\1\s*>", re.S | re.I)
TAG = re.compile(r"<[^>]+>")
BLANKS = re.compile(r"\n{3,}")
SPACES = re.compile(r"[ \t]{2,}")


def to_markdown(raw):
    s = HTML_COMMENT.sub(" ", raw)
    s = DROP_ELEMENTS.sub(" ", s)
    s = DROP_COMMENTS_WIDGET.sub(" ", s)
    body = s[s.index("<body") :] if "<body" in s else s
    # Keep h1-h3 as Markdown headings: they carry the page's own structure, which
    # is what makes a retrieved chunk legible on its own.
    body = HEADING.sub(lambda m: "\n\n" + "#" * int(m.group(1)) + " " + TAG.sub("", m.group(2)).strip() + "\n\n", body)
    body = BLOCK.sub("\n\n", body)
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    text = html.unescape(TAG.sub(" ", body))
    text = SPACES.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return BLANKS.sub("\n\n", text).strip()


def page_meta(raw, rel_path):
    title = TITLE.search(raw)
    title = html.unescape(title.group(1)).strip() if title else os.path.basename(rel_path)
    override = META_URL.search(raw) or CANONICAL.search(raw)
    if override:
        url = override.group(1)
        url = url if url.startswith("http") else SITE + url
    else:
        url = SITE + "/" + rel_path[: -len(".html")] + ".html"
    lang = LANG.search(raw)
    lang = (lang.group(1) if lang else "zh-CN").lower()
    return title, url, "en" if lang.startswith("en") else "zh"


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: export-corpus.py <src-html-dir> <out-dir>")
    src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    written = skipped = 0
    for dirpath, _, names in os.walk(src):
        for n in names:
            if not n.endswith(".html"):
                continue
            path = os.path.join(dirpath, n)
            rel = os.path.relpath(path, src).replace(os.sep, "/")
            try:
                raw = open(path, encoding="utf-8").read()
            except Exception:
                skipped += 1
                continue
            text = to_markdown(raw)
            # Nav-only pages (redirect stubs, the odd empty shell) carry no prose
            # worth a vector. 400 chars is comfortably below the shortest real
            # article and above the longest stub.
            if len(text) < 400:
                skipped += 1
                continue
            title, url, lang = page_meta(raw, rel)
            dest = os.path.join(out, rel[: -len(".html")] + ".md")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(f"---\ntitle: {title}\nurl: {url}\nlang: {lang}\n---\n\n")
                f.write(f"# {title}\n\n{text}\n")
            written += 1
    print(f"corpus: {written} pages written, {skipped} skipped (too short / unreadable)")


if __name__ == "__main__":
    main()
