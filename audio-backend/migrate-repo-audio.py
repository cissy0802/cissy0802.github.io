#!/usr/bin/env python3
"""Move one content repo's baked TTS MP3s from git to R2.

Run once per repo, in this order (./r2-creds.sh exec supplies the credentials
from the keychain, so they never touch a terminal or a shell history):

    ./r2-creds.sh exec -- ./migrate-repo-audio.py ~/Desktop/repos/personal-finance
    ./r2-creds.sh exec -- ./migrate-repo-audio.py ~/Desktop/repos/personal-finance --verify
    ./migrate-repo-audio.py ~/Desktop/repos/personal-finance --untrack   # no creds needed

Upload is idempotent: objects already in the bucket with the right size are
skipped, so a partial run can just be re-run.

--untrack is the only destructive step and is deliberately separate: it runs
`git rm -r --cached audio` and stages .gitignore, leaving the files on disk and
the commit for you to make. Don't run it until --verify passes, and don't
bother with `git filter-repo` on top unless the repo is large — history holds
very little redundant audio (measured ~100MB across the whole fleet).

Needs: pip install boto3 requests
"""
from __future__ import annotations

import argparse
import os
import subprocess
import time
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BUCKET = os.environ.get("R2_BUCKET", "bigcat-audio")
WORKER = os.environ.get("AUDIO_WORKER", "https://bigcat-audio.cissychen.workers.dev")


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
        config=Config(signature_version="s3v4", retries={"max_attempts": 5}),
    )


def local_mp3s(repo: Path) -> list[tuple[str, Path]]:
    """[(bucket key, file), ...] for every MP3 under the repo's audio/."""
    out = []
    for lang in ("zh", "en"):
        d = repo / "audio" / lang
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.mp3")):
            out.append((f"{repo.name}/{lang}/{f.name}", f))
    return out


def existing_sizes(s3, prefix: str) -> dict[str, int]:
    sizes, token = {}, None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": prefix + "/"}
        if token:
            kw["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kw)
        for o in resp.get("Contents", []):
            sizes[o["Key"]] = o["Size"]
        if not resp.get("IsTruncated"):
            return sizes
        token = resp["NextContinuationToken"]


def upload(repo: Path) -> int:
    s3 = client()
    items = local_mp3s(repo)
    if not items:
        sys.exit(f"ERROR: no MP3s under {repo}/audio — nothing to migrate")
    have = existing_sizes(s3, repo.name)
    todo = [(k, f) for k, f in items if have.get(k) != f.stat().st_size]
    total_mb = sum(f.stat().st_size for _, f in items) / 1048576
    print(f"{repo.name}: {len(items)} MP3s ({total_mb:.0f}MB), "
          f"{len(items) - len(todo)} already in r2://{BUCKET}, {len(todo)} to upload")

    done = [0]

    def put(item):
        key, f = item
        s3.put_object(
            Bucket=BUCKET, Key=key, Body=f.read_bytes(),
            ContentType="audio/mpeg",
            CacheControl="public, max-age=31536000, immutable",
        )
        done[0] += 1
        if done[0] % 25 == 0 or done[0] == len(todo):
            print(f"  uploaded {done[0]}/{len(todo)}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(put, todo))

    after = existing_sizes(s3, repo.name)
    bad = [k for k, f in items if after.get(k) != f.stat().st_size]
    if bad:
        print(f"MISMATCH: {len(bad)} objects wrong or missing, e.g. {bad[:3]}", file=sys.stderr)
        return 1
    print(f"OK: all {len(items)} objects present in r2://{BUCKET}/{repo.name}/ with matching sizes")
    return 0


def verify(repo: Path, sample: int) -> int:
    """Fetch through the Worker — proves routing, CORS and the bytes, which a
    bucket listing does not."""
    import requests

    items = local_mp3s(repo)
    if not items:
        sys.exit(f"ERROR: no local MP3s under {repo}/audio to check against")
    step = max(1, len(items) // sample)
    probe = items[::step][:sample]
    origin = "https://hub.cissychen.com"

    def probe_once(key, size):
        """(ok, detail). An HTML body means Cloudflare answered, not the Worker
        — that happens for a minute or so after a deploy while the new version
        rolls out to the edge, so it is worth retrying rather than reporting."""
        try:
            r = requests.get(f"{WORKER}/{key}", headers={"Origin": origin}, timeout=30)
        except Exception as e:
            return False, str(e)
        ctype = r.headers.get("Content-Type", "")
        cors = r.headers.get("Access-Control-Allow-Origin")
        if r.status_code == 200 and len(r.content) == size and cors == origin and "audio" in ctype:
            return True, ""
        return False, (f"status={r.status_code} bytes={len(r.content)}/{size} "
                       f"cors={cors!r} type={ctype!r}")

    fails = 0
    for key, f in probe:
        size = f.stat().st_size
        ok, detail = probe_once(key, size)
        if not ok:
            time.sleep(3)
            ok, detail = probe_once(key, size)
        if not ok:
            fails += 1
            print(f"  FAIL {key}: {detail}", file=sys.stderr)
    checked = len(probe)
    print(f"{repo.name}: {checked - fails}/{checked} sampled objects serve correctly "
          f"(200 + exact bytes + CORS for {origin})")
    if fails:
        print("Do NOT untrack audio/ until this is clean.", file=sys.stderr)
    return 1 if fails else 0


def git(repo: Path, *args, check=False):
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, check=check)


def untrack(repo: Path) -> int:
    if not (repo / ".gitignore").exists():
        sys.exit(f"ERROR: {repo}/.gitignore missing — add 'audio/' to it first")
    if "audio/" not in (repo / ".gitignore").read_text():
        sys.exit(f"ERROR: {repo}/.gitignore does not ignore audio/")

    # A bake that landed upstream while this repo was being migrated has MP3s
    # this clone has never seen. Untracking from a stale checkout removes only
    # the locally-known files and silently leaves the newer ones in git — which
    # is exactly what happened to personal-finance's Day 8.
    git(repo, "fetch", "--quiet", "origin")
    behind = git(repo, "rev-list", "--count", "HEAD..@{u}").stdout.strip()
    if behind and behind != "0":
        sys.exit(f"ERROR: {repo.name} is {behind} commit(s) behind origin. "
                 f"Run `git -C {repo} pull --rebase`, re-run the upload so any "
                 f"newly baked MP3s reach R2, then untrack.")
    n = subprocess.run(["git", "-C", str(repo), "ls-files", "audio"],
                       capture_output=True, text=True).stdout.count("\n")
    if not n:
        print(f"{repo.name}: audio/ already untracked")
        return 0
    subprocess.run(["git", "-C", str(repo), "rm", "-r", "--cached", "--quiet", "audio"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", ".gitignore"], check=True)
    print(f"{repo.name}: staged removal of {n} tracked MP3s (files kept on disk).\n"
          f"  Review with: git -C {repo} status\n"
          f"  Then commit and push.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", type=Path)
    ap.add_argument("--verify", action="store_true", help="fetch a sample through the Worker")
    ap.add_argument("--sample", type=int, default=20)
    ap.add_argument("--untrack", action="store_true", help="git rm -r --cached audio")
    args = ap.parse_args()

    repo = args.repo.expanduser().resolve()
    if not (repo / ".git").is_dir():
        sys.exit(f"ERROR: {repo} is not a git repo")

    if args.verify:
        return verify(repo, args.sample)
    if args.untrack:
        return untrack(repo)
    return upload(repo)


if __name__ == "__main__":
    sys.exit(main())
