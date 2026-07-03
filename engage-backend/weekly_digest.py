#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Weekly digest — email each tab's confirmed subscribers this week's new content.

Runs anywhere with internet (local, or a cloud routine — no repos to mount).
For each content repo it asks the GitHub API what content pages were added in the
window, pulls their titles, builds an email (zh + en), and calls the Worker
`/send` endpoint (which only mails that list's *confirmed* subscribers, per
language). Tabs with no new content that week are skipped.

Env:
  BIGCAT_ADMIN_TOKEN   required to actually send (the /send admin token)
  GITHUB_TOKEN         optional, raises GitHub API rate limit (recommended)

Usage:
  python3 weekly_digest.py --dry          # print what each tab would send
  python3 weekly_digest.py                # send for real
  python3 weekly_digest.py --days 7       # window size (default 7)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = os.environ.get("ENGAGE_API", "https://bigcat-engage.cissychen.workers.dev")
SITE = "https://cissy0802.github.io"
OWNER = "cissy0802"
BRANCH = "main"

# The site itself is the source of truth for which tabs exist and in what
# order: discover_tabs() reads the landing page's column cards at runtime, so
# the digest never drifts out of sync (new tabs are picked up automatically).
# repo name == subscription list slug (that's how the site tags subscribers).
# This list is only a fallback if the landing page can't be fetched/parsed;
# keep it in the same order the cards appear on the site.
SITE_REPO = "cissy0802.github.io"  # the landing-page repo
FALLBACK_TABS = [
    "thinker-arena", "deep-research", "mental-models", "meta-knowledge",
    "super-individual", "ai-ml", "system-design", "cs-papers-deepread",
    "leadership", "writing", "health-longevity", "parenting", "psychology",
    "family-craft", "philosophy", "buddhism", "art-aesthetics", "biographies",
    "book-recommendations", "deep-reading", "mathematics", "history",
    "investing", "civics-geopolitics",
]

# content pages, by tab naming scheme:
#   *-day1 / *-week1 / *-book1 / *-read1 (opt. letter, e.g. read3b) numbered,
#   *-YYYY-MM-DD dated, and deep-research's *-deep pages (its *-plain twin is
#   intentionally not matched, so each piece is listed once).
CONTENT_RE = re.compile(
    r"-(day|week|book|read)\d+[a-z]?\.html$|-\d{4}-\d{2}-\d{2}\.html$|-deep\.html$"
)

# git's well-known empty tree — diffing against it lists every file as "added",
# used for a tab launched entirely within the window (all its pages are new).
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

UA = "bigcat-weekly-digest/1.0"


# --- GitHub data via local git ---
# api.github.com REST is unreachable from the Claude Code cloud sandbox (the
# security proxy gates it behind a connected GitHub App), but `git clone` and
# raw.githubusercontent.com are allowed. We therefore serve the two
# api.github.com shapes this script uses — `commits?until=` and
# `compare/BASE...HEAD` — from a lightweight blobless, no-checkout clone
# (which skips the large baked TTS audio blobs, ~250K per repo). Callers
# (new_pages / new_debates) are unchanged. Locally, where api.github.com is
# reachable, set ENGAGE_USE_API=1 to fall back to the original REST path.
_CLONE_ROOT = None
_CLONES = {}


def _clone(repo):
    """Blobless, checkout-free clone of OWNER/repo. Returns local path, or
    None if the repo is missing/unreachable (mapped to a 404 by callers)."""
    global _CLONE_ROOT
    if repo in _CLONES:
        return _CLONES[repo]
    if _CLONE_ROOT is None:
        _CLONE_ROOT = tempfile.mkdtemp(prefix="wd-clones-")
    dest = os.path.join(_CLONE_ROOT, repo)
    url = "https://github.com/%s/%s" % (OWNER, repo)
    try:
        r = subprocess.run(
            ["git", "clone", "--filter=blob:none", "--no-checkout", "--quiet", url, dest],
            capture_output=True, text=True, timeout=300,
        )
        ok = r.returncode == 0
    except Exception:
        ok = False
    _CLONES[repo] = dest if ok else None
    return _CLONES[repo]


def _git(dest, *args):
    return subprocess.run(
        ["git", "-C", dest, *args], capture_output=True, text=True, timeout=120
    ).stdout


def _gh_api(path):
    url = "https://api.github.com" + path
    headers = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        headers["Authorization"] = "Bearer " + tok
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def gh(path):
    if os.environ.get("ENGAGE_USE_API"):
        return _gh_api(path)
    # /repos/OWNER/REPO/commits?until=ISO&per_page=1 -> [{"sha": last-before-ISO}]
    m = re.match(r"/repos/[^/]+/([^/]+)/commits\?until=([^&]+)", path)
    if m:
        repo, until = m.group(1), urllib.parse.unquote(m.group(2))
        dest = _clone(repo)
        if dest is None:
            raise urllib.error.HTTPError(path, 404, "Not Found", {}, None)
        sha = _git(dest, "rev-list", "-1", "--before=" + until, "origin/HEAD").strip()
        return [{"sha": sha}] if sha else []
    # /repos/OWNER/REPO/compare/BASE...HEAD -> {"files": [{"filename","status"}]}
    m = re.match(r"/repos/[^/]+/([^/]+)/compare/([^.]+)\.\.\.(.+)$", path)
    if m:
        repo, base, head = m.group(1), m.group(2), m.group(3)
        dest = _clone(repo)
        if dest is None:
            raise urllib.error.HTTPError(path, 404, "Not Found", {}, None)
        head_ref = "origin/HEAD" if head == BRANCH else head
        out = _git(dest, "diff", "--name-status", base, head_ref)
        smap = {"A": "added", "M": "modified", "D": "removed"}
        files = []
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            status = smap.get(parts[0][:1], parts[0].lower())
            files.append({"filename": parts[-1], "status": status})
        return {"files": files}
    raise ValueError("unsupported gh path: " + path)


def raw_title(repo, fn):
    """Fetch <title> (or first <h1>) of a content page from GitHub raw."""
    url = "https://raw.githubusercontent.com/%s/%s/%s/%s" % (OWNER, repo, BRANCH, fn)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", "ignore")
    except Exception:
        return None
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not m:
        m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
    if not m:
        return None
    return re.sub(r"<[^>]+>", "", m.group(1)).strip() or None


def discover_tabs():
    """Tab slugs in site order, read from the landing page's column cards, so
    the digest tracks the site automatically. Falls back to FALLBACK_TABS."""
    url = "https://raw.githubusercontent.com/%s/%s/%s/index.html" % (OWNER, SITE_REPO, BRANCH)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", "ignore")
    except Exception:
        return list(FALLBACK_TABS)
    slugs = []
    for m in re.finditer(re.escape(SITE) + r'/([a-z0-9-]+)/"', html):
        s = m.group(1)
        if s not in slugs:
            slugs.append(s)
    return slugs or list(FALLBACK_TABS)


def new_pages(repo, since_iso):
    """Return list of added content .html files (zh version) since `since_iso`."""
    # base = last commit before the window; compare base...HEAD gives changed files.
    try:
        before = gh("/repos/%s/%s/commits?until=%s&per_page=1" % (OWNER, repo, since_iso))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []  # repo missing / renamed
        raise
    # brand-new tab (no commit before the window): everything it holds is new,
    # so diff against the empty tree instead of skipping it.
    base = before[0]["sha"] if before else EMPTY_TREE
    cmp = gh("/repos/%s/%s/compare/%s...%s" % (OWNER, repo, base, BRANCH))
    seen = {}
    for f in cmp.get("files", []):
        fn = f.get("filename", "")
        if f.get("status") != "added":
            continue  # only genuinely new pages (skip reformats/bake edits)
        if fn.endswith(".en.html"):
            continue  # dedupe: track the zh file; en title fetched alongside
        if CONTENT_RE.search(fn):
            seen[fn] = True
    return list(seen)


def new_debates(since_iso):
    """thinker-arena new content is a debate JSON, not an .html page.
    Return [(slug, question_zh, question_en)] for debates added this week."""
    try:
        before = gh("/repos/%s/thinker-arena/commits?until=%s&per_page=1" % (OWNER, since_iso))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        raise
    if not before:
        return []
    base = before[0]["sha"]
    cmp = gh("/repos/%s/thinker-arena/compare/%s...%s" % (OWNER, base, BRANCH))
    out = []
    for f in cmp.get("files", []):
        fn = f.get("filename", "")
        if f.get("status") != "added":
            continue
        m = re.match(r"debates/([^/]+)\.json$", fn)
        if not m or m.group(1) == "index":
            continue
        slug = m.group(1)
        try:
            url = "https://raw.githubusercontent.com/%s/thinker-arena/%s/%s" % (OWNER, BRANCH, fn)
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8", "ignore"))
        except Exception:
            continue
        out.append((slug, d.get("question"), d.get("question_en")))
    return out


def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _wrap(head_sub, title, intro, body_html, cta_url, cta, en):
    """Shared BigCat email chrome (header / title / body / CTA / footer)."""
    return (
        '<!DOCTYPE html><html lang="%s"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
        '<body style="margin:0;padding:0;background:#f4f5f8">'
        '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f5f8"><tr>'
        '<td align="center" style="padding:28px 12px">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e8ee">'
        '<tr><td style="background:linear-gradient(135deg,#1a1a2e,#2a2350 55%%,#3a2a5e);padding:24px 32px">'
        '<div style="font-family:-apple-system,sans-serif;font-size:19px;font-weight:800;color:#fff;letter-spacing:1px">BigCat&#39;s Learning Hub</div>'
        '<div style="font-family:-apple-system,sans-serif;font-size:12px;color:#a9b0c8;margin-top:4px;letter-spacing:2px;text-transform:uppercase">%s</div>'
        "</td></tr>"
        '<tr><td style="padding:30px 32px 8px;font-family:-apple-system,\'Noto Serif SC\',sans-serif;color:#1f2330">'
        '<h1 style="margin:0 0 12px;font-size:21px;font-weight:800;color:#1a1a2e">%s</h1>'
        '<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#454b5c">%s</p>'
        "%s"
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr>'
        '<td style="border-radius:9px;background:#7b61ff"><a href="%s" style="display:inline-block;padding:11px 24px;font-family:-apple-system,sans-serif;font-size:14px;font-weight:700;color:#fff;text-decoration:none">%s</a></td>'
        "</tr></table>"
        "</td></tr>"
        '<tr><td style="padding:18px 32px 26px;border-top:1px solid #eef0f4;font-family:-apple-system,sans-serif">'
        '<div style="font-size:12px;color:#9aa0b0">BigCat · <a href="%s" style="color:#7b61ff;text-decoration:none">cissy0802.github.io</a></div>'
        "</td></tr></table></td></tr></table></body></html>"
        % ("en" if en else "zh-CN", head_sub, esc(title), esc(intro), body_html, esc(cta_url), esc(cta), SITE)
    )


def _item_row(url, t, read):
    return (
        '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0"><tr>'
        '<td style="border-left:3px solid #7b61ff;padding:3px 0 3px 15px">'
        '<div style="font-size:15px;font-weight:700;color:#1a1a2e;line-height:1.45">%s</div>'
        '<div style="font-size:13px;margin-top:2px"><a href="%s" style="color:#7b61ff;text-decoration:none;font-weight:600">%s</a></div>'
        "</td></tr></table>" % (esc(t), esc(url), read)
    )


def build_email(repo, items, en, label=None, debate=False):
    """items: list of (url, title). Returns full HTML email body."""
    label = label or repo
    head_sub = "每日学习 · 跨界思考" if not en else "Daily learning · cross-domain thinking"
    if debate:
        title = ("本周新辩论 · %s" % label) if not en else ("New debates · %s" % label)
        intro = ("这周思想圆桌新开了 %d 场辩论:" % len(items)) if not en \
            else ("%d new debate(s) this week:" % len(items))
        cta = "去思想圆桌看看 →" if not en else "Open the Round Table →"
    else:
        title = ("本周更新 · %s" % label) if not en else ("This week · %s" % label)
        intro = ("这周 %s 有 %d 篇新内容:" % (label, len(items))) if not en \
            else ("%d new piece(s) this week on %s:" % (len(items), label))
        cta = "去这个专栏看看 →" if not en else "Open this tab →"
    MAX_ITEMS = 15
    extra = len(items) - MAX_ITEMS
    read = "阅读 →" if not en else "Read →"
    rows = "".join(_item_row(url, t, read) for url, t in items[:MAX_ITEMS])
    if extra > 0:
        more = ("…还有 %d 篇，去专栏看全部。" % extra) if not en else ("…and %d more — see them all on the tab." % extra)
        rows += '<p style="font-size:13px;color:#8a90a0;margin:2px 0 0">%s</p>' % more
    tab_url = "%s/%s/%s" % (SITE, repo, "index.en.html" if en else "")
    return _wrap(head_sub, title, intro, rows, tab_url, cta, en)


def build_hub_email(sections, en):
    """One combined 'everything new this week' digest for the hub list.

    sections: [(label, tab_url, [(url, title), ...]), ...] — one entry per tab
    that had new content, in the order tabs were scanned."""
    total = sum(len(items) for _, _, items in sections)
    head_sub = "每日学习 · 跨界思考" if not en else "Daily learning · cross-domain thinking"
    title = "本周更新 · 全站精选" if not en else "This week across BigCat"
    intro = ("这周各专栏共有 %d 篇新内容:" % total) if not en \
        else ("%d new pieces across all tabs this week:" % total)
    cta = "去 BigCat 首页 →" if not en else "Open BigCat →"
    read = "阅读 →" if not en else "Read →"
    unit = "篇" if not en else "new"
    body = ""
    for label, tab_url, items in sections:
        body += (
            '<div style="margin:24px 0 10px">'
            '<a href="%s" style="font-size:16px;font-weight:800;color:#1a1a2e;text-decoration:none">%s</a>'
            '<span style="font-size:12px;color:#8a90a0;font-weight:600;margin-left:7px">%d %s</span>'
            "</div>" % (esc(tab_url), esc(label), len(items), unit)
        )
        body += "".join(_item_row(url, t, read) for url, t in items)
    return _wrap(head_sub, title, intro, body, SITE, cta, en)


def send(list_slug, subject, html, lang, admin, dry):
    payload = {"admin": admin, "list": list_slug, "subject": subject,
               "html": html, "lang": lang, "dry": dry}
    req = urllib.request.Request(
        API.rstrip("/") + "/send",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "error": "http_%d" % e.code}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--only", default=None,
                    help="only send to this list slug (e.g. 'hub'); others are still "
                         "scanned so the hub digest stays complete, just not emailed")
    args = ap.parse_args()

    admin = os.environ.get("BIGCAT_ADMIN_TOKEN", "")
    if not args.dry and not admin:
        sys.exit("✗ set BIGCAT_ADMIN_TOKEN to send (or use --dry)")

    since = (datetime.now(tz=timezone.utc) - timedelta(days=args.days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    print("Window: since %s (%d days)\n" % (since, args.days))

    # hub = a single combined digest of everything new this week (the landing
    # page's "subscribe to all" list). Accumulated across every tab below.
    hub_zh, hub_en = [], []

    tabs = discover_tabs()
    order = {slug: i for i, slug in enumerate(tabs)}
    content_repos = [t for t in tabs if t != "thinker-arena"]
    print("Tabs: %d columns in site order\n" % len(tabs))

    for repo in content_repos:
        try:
            pages = new_pages(repo, since)
        except Exception as e:  # noqa: BLE001
            if "rate limit" in str(e).lower() or "403" in str(e):
                print("\n✗ GitHub API rate limit. Set a token and retry:")
                print("    export GITHUB_TOKEN='ghp_...'   # any GitHub token → 5000/hr")
                print("  (Cloud routines already have a token, so this only bites local runs.)")
                return
            print("  %-22s ! %s" % (repo, e))
            continue
        if not pages:
            continue
        zh_items, en_items = [], []
        for fn in pages:
            zt = raw_title(repo, fn)
            if zt:
                zh_items.append(("%s/%s/%s" % (SITE, repo, fn), zt))
            en_fn = fn[:-5] + ".en.html"
            et = raw_title(repo, en_fn)
            if et:
                en_items.append(("%s/%s/%s" % (SITE, repo, en_fn), et))

        if zh_items:
            hub_zh.append((order.get(repo, 999), repo, "%s/%s/" % (SITE, repo), zh_items))
        if en_items:
            hub_en.append((order.get(repo, 999), repo, "%s/%s/index.en.html" % (SITE, repo), en_items))

        print("  %-22s %d new page(s)" % (repo, len(pages)))
        for lang, items, subj in (
            ("zh", zh_items, "本周更新 · %s" % repo),
            ("en", en_items, "This week · %s" % repo),
        ):
            if not items:
                continue
            if args.only and args.only != repo:
                continue
            html = build_email(repo, items, en=(lang == "en"))
            r = send(repo, subj, html, lang, admin, args.dry)
            if not r.get("ok"):
                print("      [%s] ✗ %s" % (lang, r.get("error")))
            elif args.dry:
                print("      [%s] would send to %d subscriber(s)" % (lang, r.get("recipients", 0)))
            else:
                print("      [%s] sent to %d/%d" % (lang, r.get("sent", 0), r.get("total", 0)))

    # thinker-arena: new debates (list slug "thinker-arena")
    try:
        debs = new_debates(since)
    except Exception as e:  # noqa: BLE001
        if "rate limit" in str(e).lower() or "403" in str(e):
            print("\n✗ GitHub API rate limit — set GITHUB_TOKEN and retry.")
            return
        debs = []
    if debs:
        zh_items = [("%s/thinker-arena/debate.html?d=%s" % (SITE, s), q) for s, q, _ in debs if q]
        en_items = [("%s/thinker-arena/debate.en.html?d=%s" % (SITE, s), qe) for s, _, qe in debs if qe]
        if zh_items:
            hub_zh.append((order.get("thinker-arena", 999), "思想圆桌", "%s/thinker-arena/" % SITE, zh_items))
        if en_items:
            hub_en.append((order.get("thinker-arena", 999), "Thinking Hub", "%s/thinker-arena/index.en.html" % SITE, en_items))
        print("  %-22s %d new debate(s)" % ("thinker-arena", len(debs)))
        for lang, items, subj, lbl in (
            ("zh", zh_items, "本周新辩论 · 思想圆桌", "思想圆桌"),
            ("en", en_items, "New debates · Thinking Hub", "Thinking Hub"),
        ):
            if not items:
                continue
            if args.only and args.only != "thinker-arena":
                continue
            html = build_email("thinker-arena", items, en=(lang == "en"), label=lbl, debate=True)
            r = send("thinker-arena", subj, html, lang, admin, args.dry)
            if not r.get("ok"):
                print("      [%s] ✗ %s" % (lang, r.get("error")))
            elif args.dry:
                print("      [%s] would send to %d subscriber(s)" % (lang, r.get("recipients", 0)))
            else:
                print("      [%s] sent to %d/%d" % (lang, r.get("sent", 0), r.get("total", 0)))

    # hub: one combined digest of everything new this week -> list "hub".
    # Sort sections into site (card) order so the email matches the landing page.
    hub_zh.sort(key=lambda x: x[0])
    hub_en.sort(key=lambda x: x[0])
    for lang, tagged, subj in (
        ("zh", hub_zh, "本周更新 · BigCat 全站精选"),
        ("en", hub_en, "This week across BigCat"),
    ):
        if not tagged:
            continue
        if args.only and args.only != "hub":
            continue
        sections = [(lbl, url, items) for _, lbl, url, items in tagged]
        n = sum(len(items) for _, _, items in sections)
        html = build_hub_email(sections, en=(lang == "en"))
        r = send("hub", subj, html, lang, admin, args.dry)
        if not r.get("ok"):
            print("  %-22s [%s] ✗ %s" % ("hub", lang, r.get("error")))
        elif args.dry:
            print("  %-22s [%s] %d item(s) across %d tab(s) → would send to %d subscriber(s)"
                  % ("hub", lang, n, len(sections), r.get("recipients", 0)))
        else:
            print("  %-22s [%s] %d item(s) across %d tab(s) → sent to %d/%d"
                  % ("hub", lang, n, len(sections), r.get("sent", 0), r.get("total", 0)))
    print("\nDone.")


if __name__ == "__main__":
    main()
