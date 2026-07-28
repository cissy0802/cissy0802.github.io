#!/usr/bin/env python3
"""Pull the whole audio bucket down to local disk, so R2 isn't the only copy.

    ./r2-creds.sh exec -- ./mirror-r2.py ~/BigCatAudioBackup      # one tree
    ./r2-creds.sh exec -- ./mirror-r2.py --into-repos             # each repo's audio/
    ./r2-creds.sh exec -- ./mirror-r2.py ~/BigCatAudioBackup --check

Idempotent: an object already on disk with the same size is skipped, so a
repeat run costs one LIST per repo and downloads only what is new. That makes
it safe to put on a timer.

--into-repos restores the layout the migration tools expect (<repo>/audio/…,
gitignored). Use it to close the gap left by CI: anything baked after a repo
migrated was born in R2 and has never existed anywhere else.

Note what this does and does not protect against. It is a second copy, so it
survives an accidental delete on our side — the realistic risk, given
prune-orphans.py exists. It does not survive losing the Cloudflare account,
and it is only as fresh as its last run.

Needs: pip install boto3
"""
from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BUCKET = os.environ.get("R2_BUCKET", "bigcat-audio")
REPOS = Path("/Users/cissychen/Desktop/repos")


def client():
    import boto3
    from botocore.config import Config

    missing = [k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
               if not os.environ.get(k)]
    if missing:
        sys.exit(f"ERROR: missing env vars: {', '.join(missing)}")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 5},
                      max_pool_connections=20),
    )


def all_objects(s3) -> list[tuple[str, int]]:
    out, tok = [], None
    while True:
        kw = {"Bucket": BUCKET}
        if tok:
            kw["ContinuationToken"] = tok
        r = s3.list_objects_v2(**kw)
        out += [(o["Key"], o["Size"]) for o in r.get("Contents", [])]
        if not r.get("IsTruncated"):
            return out
        tok = r["NextContinuationToken"]


def target(key: str, dest: Path | None) -> Path:
    repo, rel = key.split("/", 1)
    # Into the repos: <repo>/audio/<rel>, which is where the tools look.
    # Into a tree: <dest>/<repo>/<rel>, one directory to copy off the machine.
    return (REPOS / repo / "audio" / rel) if dest is None else (dest / repo / rel)


def warn_if_scheduled_copy_is_stale() -> None:
    """The LaunchAgent runs a COPY of this script from ~/.bigcat-hub/bin.

    It has to: macOS TCC blocks background jobs from ~/Desktop, so the agent
    cannot read the version in the repo. That makes the copy exactly the kind
    of silent fork this whole migration kept tripping over — so say something
    when the two diverge, on every interactive run.
    """
    import hashlib

    installed = Path.home() / ".bigcat-hub" / "bin" / Path(__file__).name
    if not installed.exists():
        return
    here = Path(__file__).resolve()
    if here == installed.resolve():
        return
    if hashlib.sha256(installed.read_bytes()).digest() != hashlib.sha256(here.read_bytes()).digest():
        print(f"WARNING: {installed} differs from this script — the scheduled mirror is "
              f"running an old copy.\n         Refresh it with: cp {here} {installed}",
              file=sys.stderr)


def main():
    warn_if_scheduled_copy_is_stale()
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("dest", nargs="?", type=Path)
    ap.add_argument("--into-repos", action="store_true")
    ap.add_argument("--check", action="store_true", help="report the gap, download nothing")
    args = ap.parse_args()
    if args.into_repos:
        dest = None
    elif args.dest:
        dest = args.dest.expanduser().resolve()
    else:
        sys.exit("ERROR: give a destination directory, or --into-repos")

    s3 = client()
    objs = all_objects(s3)
    todo = [(k, n) for k, n in objs
            if not (target(k, dest).exists() and target(k, dest).stat().st_size == n)]
    have_mb = sum(n for k, n in objs if (k, n) not in set(todo)) / 1048576
    print(f"bucket: {len(objs)} objects / {sum(n for _, n in objs)/1073741824:.2f}GB")
    print(f"already local: {len(objs)-len(todo)} ({have_mb/1024:.2f}GB)   to fetch: {len(todo)}")

    if args.check or not todo:
        by_repo = {}
        for k, _ in todo:
            by_repo[k.split("/")[0]] = by_repo.get(k.split("/")[0], 0) + 1
        for r, n in sorted(by_repo.items()):
            print(f"  {r}: {n} missing")
        return 0

    done = [0]

    def fetch(item):
        key, size = item
        p = target(key, dest)
        p.parent.mkdir(parents=True, exist_ok=True)
        # Download to a temp name and rename, so an interrupted run can't leave
        # a truncated file that the next run mistakes for a complete one.
        tmp = p.with_suffix(p.suffix + ".part")
        s3.download_file(BUCKET, key, str(tmp))
        if tmp.stat().st_size != size:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"{key}: got {tmp.stat().st_size}B, expected {size}B")
        tmp.replace(p)
        done[0] += 1
        if done[0] % 100 == 0 or done[0] == len(todo):
            print(f"  fetched {done[0]}/{len(todo)}")

    errs = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        for item, res in zip(todo, pool.map(lambda i: _safe(fetch, i), todo)):
            if res:
                errs.append((item[0], res))
    for k, e in errs[:5]:
        print(f"  FAILED {k}: {e}", file=sys.stderr)

    still = [k for k, n in objs
             if not (target(k, dest).exists() and target(k, dest).stat().st_size == n)]
    print(f"{len(objs)-len(still)}/{len(objs)} objects present locally with matching size")
    return 1 if still else 0


def _safe(fn, item):
    try:
        fn(item)
        return None
    except Exception as e:
        return str(e)[:80]


if __name__ == "__main__":
    sys.exit(main())
