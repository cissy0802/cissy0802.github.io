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
import subprocess
import sys
from datetime import datetime, timezone

DB = "bigcat-engage"


def q(sql):
    """Run a SQL query against the remote D1 and return the list of rows."""
    try:
        out = subprocess.run(
            ["npx", "wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except FileNotFoundError:
        sys.exit("✗ npx/wrangler not found. Run this from a shell where `npx wrangler` works.")
    except subprocess.CalledProcessError as e:
        sys.exit(f"✗ wrangler failed:\n{e.stderr or e.stdout}")
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
        n_subs = q("SELECT COUNT(*) AS n FROM subscribers")[0]["n"]
        new_subs = q("SELECT COUNT(*) AS n FROM subscribers WHERE ts > ?".replace(
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

    # ---- Subscribers ----
    subs = q("SELECT email, ts FROM subscribers ORDER BY ts DESC")
    recent_subs = [s for s in subs if days_ago(s["ts"], args.days)]
    print(f"\n📬 SUBSCRIBERS — {len(subs)} total", end="")
    if args.days is not None:
        print(f"  ({len(recent_subs)} in last {args.days}d)")
    else:
        print()
    for s in (recent_subs if args.days is not None else subs)[:30]:
        print(f"   {fmt_ts(s['ts'])}   {s['email']}")
    if not subs:
        print("   (none yet)")

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
