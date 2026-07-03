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
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = os.environ.get("ENGAGE_API", "https://bigcat-engage.cissychen.workers.dev")
SITE = "https://cissy0802.github.io"
OWNER = "cissy0802"
BRANCH = "main"

# repo name == subscription list slug (that's how the site tags subscribers).
# Edit this to match the tabs you want weekly digests for.
REPOS = [
    "mental-models", "meta-knowledge", "super-individual", "ai-ml", "system-design",
    "cs-papers-deepread", "health-longevity", "history", "parenting", "psychology",
    "mathematics", "civics-geopolitics", "book-recommendations", "buddhism",
    "philosophy", "art-aesthetics", "investing", "biographies",
]

# content pages: *-day1.html / *-week1.html / *-book1.html / *-YYYY-MM-DD.html
CONTENT_RE = re.compile(r"-(day|week|book)\d+\.html$|-\d{4}-\d{2}-\d{2}\.html$")

UA = "bigcat-weekly-digest/1.0"


def gh(path):
    url = "https://api.github.com" + path
    headers = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        headers["Authorization"] = "Bearer " + tok
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


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


def new_pages(repo, since_iso):
    """Return list of added content .html files (zh version) since `since_iso`."""
    # base = last commit before the window; compare base...HEAD gives changed files.
    try:
        before = gh("/repos/%s/%s/commits?until=%s&per_page=1" % (OWNER, repo, since_iso))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []  # repo missing / renamed
        raise
    if not before:
        return []  # no history before window (brand-new repo) — skip to stay safe
    base = before[0]["sha"]
    cmp = gh("/repos/%s/%s/compare/%s...%s" % (OWNER, repo, base, BRANCH))
    seen = {}
    for f in cmp.get("files", []):
        fn = f.get("filename", "")
        if f.get("status") not in ("added", "modified"):
            continue
        if fn.endswith(".en.html"):
            continue  # dedupe: track the zh file; en title fetched alongside
        if CONTENT_RE.search(fn):
            seen[fn] = True
    return list(seen)


def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def build_email(repo, items, en):
    """items: list of (url, title). Returns full HTML email body."""
    label = repo
    head_sub = "每日学习 · 跨界思考" if not en else "Daily learning · cross-domain thinking"
    title = ("本周更新 · %s" % label) if not en else ("This week · %s" % label)
    intro = ("这周 %s 有 %d 篇新内容:" % (label, len(items))) if not en \
        else ("%d new piece(s) this week on %s:" % (len(items), label))
    cta = "去这个专栏看看 →" if not en else "Open this tab →"
    rows = ""
    for url, t in items:
        read = "阅读 →" if not en else "Read →"
        rows += (
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0"><tr>'
            '<td style="border-left:3px solid #7b61ff;padding:3px 0 3px 15px">'
            '<div style="font-size:15px;font-weight:700;color:#1a1a2e;line-height:1.45">%s</div>'
            '<div style="font-size:13px;margin-top:2px"><a href="%s" style="color:#7b61ff;text-decoration:none;font-weight:600">%s</a></div>'
            "</td></tr></table>" % (esc(t), esc(url), read)
        )
    tab_url = "%s/%s/%s" % (SITE, repo, "index.en.html" if en else "")
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
        % ("en" if en else "zh-CN", head_sub, esc(title), esc(intro), rows, esc(tab_url), esc(cta), SITE)
    )


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
    args = ap.parse_args()

    admin = os.environ.get("BIGCAT_ADMIN_TOKEN", "")
    if not args.dry and not admin:
        sys.exit("✗ set BIGCAT_ADMIN_TOKEN to send (or use --dry)")

    since = (datetime.now(tz=timezone.utc) - timedelta(days=args.days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    print("Window: since %s (%d days)\n" % (since, args.days))

    for repo in REPOS:
        try:
            pages = new_pages(repo, since)
        except Exception as e:  # noqa: BLE001
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

        print("  %-22s %d new page(s)" % (repo, len(pages)))
        for lang, items, subj in (
            ("zh", zh_items, "本周更新 · %s" % repo),
            ("en", en_items, "This week · %s" % repo),
        ):
            if not items:
                continue
            html = build_email(repo, items, en=(lang == "en"))
            r = send(repo, subj, html, lang, admin, args.dry)
            if not r.get("ok"):
                print("      [%s] ✗ %s" % (lang, r.get("error")))
            elif args.dry:
                print("      [%s] would send to %d subscriber(s)" % (lang, r.get("recipients", 0)))
            else:
                print("      [%s] sent to %d/%d" % (lang, r.get("sent", 0), r.get("total", 0)))
    print("\nDone.")


if __name__ == "__main__":
    main()
