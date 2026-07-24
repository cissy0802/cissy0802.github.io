#!/usr/bin/env python3
"""BigCat hub — engagement digest.

Reads the live D1 database (subscribers / votes / comments) via wrangler and
prints a readable summary: subscriber count + recent signups, poll tallies,
and the latest comments.

Run from the engage-backend/ folder:
    python3 report.py            # full digest
    python3 report.py --days 7   # only signups/comments from the last N days
    python3 report.py --comments 50   # show up to N recent comments (default 20)

Times are shown in your local timezone.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

DB = "bigcat-engage"

# A pinned wrangler binary avoids `npx` re-downloading the package on every run
# (that download failed outright on the scheduled job several times). Set
# WRANGLER_BIN to override; falls back to `npx wrangler`.
WRANGLER = os.environ.get("WRANGLER_BIN")
WRANGLER_CMD = [WRANGLER] if WRANGLER else ["npx", "wrangler"]

# The OAuth access token expires and the refresh occasionally loses a race,
# surfacing as Cloudflare API error 10000. The retry re-runs after the failed
# attempt has refreshed the token, which is enough to recover.
RETRIES = 3


def q(sql):
    """Run a SQL query against the remote D1 and return the list of rows."""
    cmd = WRANGLER_CMD + ["d1", "execute", DB, "--remote", "--json", "--command", sql]
    last = ""
    for attempt in range(RETRIES):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
        except FileNotFoundError:
            sys.exit(f"✗ wrangler not found ({' '.join(WRANGLER_CMD)}).")
        except subprocess.CalledProcessError as e:
            last = e.stderr or e.stdout
            if attempt < RETRIES - 1:
                time.sleep(3 * (attempt + 1))
                continue
            sys.exit(f"✗ wrangler failed:\n{last}")
        # wrangler prints a leading banner before the JSON; grab from the first '['.
        i = out.find("[")
        if i < 0:
            sys.exit(f"✗ Unexpected wrangler output:\n{out}")
        data = json.loads(out[i:])
        return data[0].get("results", [])


def fmt_ts(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")


def days_ago(ms, days):
    if days is None:
        return True
    age = (datetime.now(tz=timezone.utc).timestamp() * 1000 - ms) / 86400000
    return age <= days


def bar(n, total, width=24):
    filled = round(width * n / total) if total else 0
    return "█" * filled + "·" * (width - filled)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None, help="only signups/comments from last N days")
    ap.add_argument("--comments", type=int, default=20, help="max recent comments to show")
    ap.add_argument("--summary", action="store_true", help="print one compact line (for notifications)")
    args = ap.parse_args()

    if args.summary:
        n_subs = q("SELECT COUNT(*) AS n FROM subscriptions WHERE confirmed=1")[0]["n"]
        new_subs = q("SELECT COUNT(*) AS n FROM subscriptions WHERE confirmed=1 AND ts > ?".replace(
            "?", str(int((datetime.now(tz=timezone.utc).timestamp() - 86400) * 1000)))
        )[0]["n"]
        n_votes = q("SELECT COUNT(*) AS n FROM votes")[0]["n"]
        n_com = q("SELECT COUNT(*) AS n FROM comments")[0]["n"]
        new_com = q("SELECT COUNT(*) AS n FROM comments WHERE ts > ?".replace(
            "?", str(int((datetime.now(tz=timezone.utc).timestamp() - 86400) * 1000)))
        )[0]["n"]
        pending = q("SELECT COUNT(*) AS n FROM comments WHERE approved=0")[0]["n"]
        parts = [f"📬 {n_subs} subs (+{new_subs})", f"🗳️ {n_votes} votes", f"💬 {n_com} comments (+{new_com})"]
        if pending:
            parts.append(f"⏳ {pending} to review")
        print(" · ".join(parts))
        return

    print("\n" + "=" * 60)
    print("  BigCat Hub · Engagement digest")
    print("  " + datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"))
    print("=" * 60)

    # ---- Subscribers (per list/tab; confirmed vs pending) ----
    subs = q("SELECT email, list, ts, confirmed, lang FROM subscriptions ORDER BY ts DESC")
    conf = [s for s in subs if s.get("confirmed", 1)]
    pending = [s for s in subs if not s.get("confirmed", 1)]
    recent_subs = [s for s in conf if days_ago(s["ts"], args.days)]
    uniq = len({s["email"] for s in conf})
    print(f"\n📬 SUBSCRIBERS — {len(conf)} confirmed · {uniq} unique emails"
          + (f" · {len(pending)} unconfirmed" if pending else ""), end="")
    if args.days is not None:
        print(f"  ({len(recent_subs)} new in last {args.days}d)")
    else:
        print()
    # per-list breakdown (confirmed only)
    by_list = {}
    for s in conf:
        by_list[s["list"]] = by_list.get(s["list"], 0) + 1
    for lst, n in sorted(by_list.items(), key=lambda kv: -kv[1]):
        print(f"     {n:>4}  {lst}")
    # language split
    n_en = sum(1 for s in conf if s.get("lang") == "en")
    n_zh = len(conf) - n_en
    if conf:
        print(f"   language: {n_zh} zh · {n_en} en")
    # recent confirmed signups
    show = (recent_subs if args.days is not None else conf)[:30]
    if show:
        print("   recent:")
        for s in show:
            print(f"     {fmt_ts(s['ts'])}   {s['email']}  [{s['list']}/{s.get('lang','zh')}]")
    if not conf:
        print("   (none confirmed yet)")

    # ---- Votes ----
    votes = q("SELECT poll, choice, COUNT(*) AS n FROM votes GROUP BY poll, choice")
    print("\n🗳️  POLLS")
    if not votes:
        print("   (no votes yet)")
    else:
        polls = {}
        for v in votes:
            polls.setdefault(v["poll"], []).append((v["choice"], v["n"]))
        for poll, rows in polls.items():
            total = sum(n for _, n in rows)
            print(f"   · {poll}  ({total} votes)")
            for choice, n in sorted(rows, key=lambda r: -r[1]):
                pct = round(100 * n / total) if total else 0
                print(f"       {bar(n, total)} {pct:>3}%  {n:>3}  {choice}")

    # ---- Comments ----
    total_c = q("SELECT COUNT(*) AS n FROM comments")[0]["n"]
    pending = q("SELECT COUNT(*) AS n FROM comments WHERE approved=0")[0]["n"]
    comments = q(
        "SELECT id, page, name, body, ts, approved FROM comments ORDER BY ts DESC LIMIT "
        + str(max(1, args.comments))
    )
    comments = [c for c in comments if days_ago(c["ts"], args.days)]
    print(f"\n💬 COMMENTS — {total_c} total", end="")
    print(f"  ({pending} awaiting review)" if pending else "")
    if not comments:
        print("   (none in range)")
    for c in comments:
        flag = "  ⏳PENDING" if not c["approved"] else ""
        body = c["body"].replace("\n", " ")
        if len(body) > 100:
            body = body[:100] + "…"
        print(f"   #{c['id']} {fmt_ts(c['ts'])}  {c['name']}  on {c['page']}{flag}")
        print(f"       {body}")

    print("\n" + "=" * 60 + "\n")


if __name__ == "__main__":
    main()
