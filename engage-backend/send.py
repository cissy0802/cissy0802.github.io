#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Send a newsletter to a tab/list's confirmed subscribers.

Sending happens server-side in the Worker (which holds RESEND_API_KEY), so no
key touches this machine. This script just calls the admin `/send` endpoint.

One-time: pick an admin token and bind it to the Worker:
    npx wrangler secret put ADMIN_TOKEN        # paste any long random string
Then make the same value available here (so you don't paste it every time):
    export BIGCAT_ADMIN_TOKEN='the-same-string'   # e.g. add to ~/.zshrc

Usage:
    # Always dry-run first — shows how many confirmed subscribers would get it:
    python3 send.py --list mental-models --subject "本周更新" --html update.html --dry

    # Then send for real:
    python3 send.py --list mental-models --subject "本周更新" --html update.html

`--html` is a file containing the email body (HTML). An unsubscribe footer +
List-Unsubscribe header are added automatically by the Worker.
"""

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("ENGAGE_API", "https://bigcat-engage.cissychen.workers.dev")


def post(payload):
    req = urllib.request.Request(
        API.rstrip("/") + "/send",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "bigcat-send/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        try:
            return json.loads(ex.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "error": "http_%d" % ex.code}
    except Exception as ex:  # noqa: BLE001
        return {"ok": False, "error": str(ex)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True, help="tab/list slug, e.g. mental-models or hub")
    ap.add_argument("--subject", required=True)
    ap.add_argument("--html", required=True, help="path to an HTML file (email body)")
    ap.add_argument("--dry", action="store_true", help="show recipient count, send nothing")
    args = ap.parse_args()

    token = os.environ.get("BIGCAT_ADMIN_TOKEN") or getpass.getpass("Admin token: ")
    if not token:
        sys.exit("✗ no admin token")

    try:
        with open(args.html, encoding="utf-8") as f:
            html = f.read()
    except OSError as e:
        sys.exit("✗ can't read %s: %s" % (args.html, e))

    payload = {
        "admin": token,
        "list": args.list,
        "subject": args.subject,
        "html": html,
        "dry": bool(args.dry),
    }

    if args.dry:
        d = post(payload)
        if not d.get("ok"):
            sys.exit("✗ %s" % d.get("error"))
        print("[dry-run] list '%s' → %d confirmed subscriber(s) would receive it."
              % (args.list, d.get("recipients", 0)))
        return

    # confirm before a real blast
    d = post({**payload, "dry": True})
    if not d.get("ok"):
        sys.exit("✗ %s" % d.get("error"))
    n = d.get("recipients", 0)
    if n == 0:
        print("No confirmed subscribers on '%s' — nothing to send." % args.list)
        return
    ans = input("Send '%s' to %d subscriber(s) on '%s'? [y/N] " % (args.subject, n, args.list))
    if ans.strip().lower() != "y":
        print("Aborted.")
        return

    d = post(payload)
    if not d.get("ok"):
        sys.exit("✗ %s" % d.get("error"))
    print("✓ sent to %d/%d on '%s'." % (d.get("sent", 0), d.get("total", 0), args.list))


if __name__ == "__main__":
    main()
