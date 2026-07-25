#!/usr/bin/env python3
"""Delete R2 objects no page references any more.

A segment's key is the sha1 of its narration text, so editing a paragraph
creates a new object and abandons the old one. mental-models was 56% dead by
size that way. Those objects are unreachable — no page can ask for them — but
they still count against storage.

    ./r2-creds.sh exec -- ./prune-orphans.py ~/Desktop/repos/mental-models
    ./r2-creds.sh exec -- ./prune-orphans.py ~/Desktop/repos/mental-models --yes

Without --yes it only reports. The key list is always written to
prune-<repo>-<n>.txt before anything is deleted.

It refuses when the orphan set looks like a bug rather than dead weight:

  * the clone is behind origin           → its pages may reference segments
                                           this checkout has never seen, which
                                           would look orphaned
  * no page references anything          → the pages lost their data-tts
                                           attributes
  * a referenced hash is missing from R2 → the reference scan or the upload is
                                           wrong, so the orphan set can't be
                                           trusted either
  * more than 80% would be deleted       → too much to take on faith

Recovery if this is ever wrong: the objects are still in the repo's git history
(and usually on disk), so a re-upload restores them.

Needs: pip install boto3 requests
"""
from __future__ import annotations

import argparse
import os
import subprocess
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BUCKET = os.environ.get("R2_BUCKET", "bigcat-audio")
WORKER = os.environ.get("AUDIO_WORKER", "https://bigcat-audio.cissychen.workers.dev")
MAX_FRACTION = 0.8


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


def require_current(repo: Path) -> None:
    """Refuse to act on a stale checkout.

    "Orphaned" is derived from the HTML in this working copy, so a clone that
    is behind origin sees freshly baked segments as unreferenced and would
    delete audio that is live on the site. This is not hypothetical: a bake
    landed in deep-research mid-session and its stale clone reported 350 of 350
    objects orphaned — a repo whose narration works perfectly.
    """
    subprocess.run(["git", "-C", str(repo), "fetch", "--quiet", "origin"], check=False)
    behind = subprocess.run(["git", "-C", str(repo), "rev-list", "--count", "HEAD..@{u}"],
                            capture_output=True, text=True).stdout.strip()
    if behind and behind != "0":
        sys.exit(f"ERROR: {repo.name} is {behind} commit(s) behind origin. Its pages may "
                 f"reference segments this checkout has never seen, which would look orphaned. "
                 f"Run `git -C {repo} pull --rebase` first.")


def referenced_hashes(repo: Path) -> set[str]:
    refs = set()
    for p in repo.glob("*.html"):
        html = p.read_text(encoding="utf-8", errors="replace")
        refs |= set(re.findall(r'data-tts(?:-(?:zh|en))?="([0-9a-f]{16})"', html))
    return refs


def list_objects(s3, prefix: str) -> list[dict]:
    out, token = [], None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": prefix + "/"}
        if token:
            kw["ContinuationToken"] = token
        r = s3.list_objects_v2(**kw)
        out += r.get("Contents", [])
        if not r.get("IsTruncated"):
            return out
        token = r["NextContinuationToken"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", type=Path)
    ap.add_argument("--yes", action="store_true", help="actually delete")
    args = ap.parse_args()
    repo = args.repo.expanduser().resolve()
    if not (repo / ".git").is_dir():
        sys.exit(f"ERROR: {repo} is not a git repo")

    import requests

    require_current(repo)
    s3 = client()
    refs = referenced_hashes(repo)
    if not refs:
        sys.exit(f"ERROR: no page in {repo.name} references any audio. Every object would look "
                 f"orphaned. Fix the pages' data-tts attributes first.")

    objs = list_objects(s3, repo.name)
    if not objs:
        sys.exit(f"ERROR: r2://{BUCKET}/{repo.name}/ is empty")
    orphans = [o for o in objs if o["Key"].split("/")[-1][:-4] not in refs]
    live_keys = {o["Key"] for o in objs} - {o["Key"] for o in orphans}

    tot = sum(o["Size"] for o in objs)
    dead = sum(o["Size"] for o in orphans)
    print(f"{repo.name}: {len(objs)} objects / {tot/1048576:.0f}MB")
    print(f"  referenced by pages: {len(objs)-len(orphans)} / {(tot-dead)/1048576:.0f}MB")
    print(f"  orphaned:            {len(orphans)} / {dead/1048576:.0f}MB "
          f"({100*dead/tot:.0f}%)")

    if not orphans:
        print("Nothing to prune.")
        return 0
    if len(orphans) > len(objs) * MAX_FRACTION:
        sys.exit(f"ERROR: {100*len(orphans)/len(objs):.0f}% of objects look orphaned, over the "
                 f"{MAX_FRACTION:.0%} ceiling. Too much to delete on the strength of a regex.")

    # Every hash a page asks for must already be in the bucket. If one isn't,
    # the reference scan and the bucket disagree, and the orphan set computed
    # from that same scan can't be trusted either.
    missing = sorted(h for h in refs
                     if not ({f"{repo.name}/zh/{h}.mp3", f"{repo.name}/en/{h}.mp3"} & live_keys))
    if missing:
        sys.exit(f"ERROR: {len(missing)} referenced hashes are NOT in the bucket "
                 f"(e.g. {missing[:3]}). Resolve that before deleting anything.")

    listing = Path(f"prune-{repo.name}-{len(orphans)}.txt")
    listing.write_text("\n".join(o["Key"] for o in sorted(orphans, key=lambda x: x["Key"])) + "\n")
    print(f"  key list written to {listing}")

    if not args.yes:
        print("\nDry run. Re-run with --yes to delete.")
        return 0

    # Spot-check through the Worker that a sample of the survivors still serves
    # AFTER the delete, so a botched batch can't pass silently.
    keys = [o["Key"] for o in orphans]
    deleted = 0
    for i in range(0, len(keys), 1000):
        batch = keys[i:i+1000]
        resp = s3.delete_objects(Bucket=BUCKET,
                                 Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True})
        errs = resp.get("Errors", [])
        if errs:
            print(f"  {len(errs)} delete errors, e.g. {errs[0]}", file=sys.stderr)
        deleted += len(batch) - len(errs)
        print(f"  deleted {deleted}/{len(keys)}")

    after = list_objects(s3, repo.name)
    print(f"{repo.name}: now {len(after)} objects / {sum(o['Size'] for o in after)/1048576:.0f}MB")

    sample = sorted(live_keys)[:: max(1, len(live_keys)//20)][:20]
    bad = 0

    def probe(k):
        r = requests.get(f"{WORKER}/{k}", timeout=45)
        return k, r.status_code == 200 and len(r.content) > 1000, r.status_code

    with ThreadPoolExecutor(max_workers=10) as pool:
        for k, ok, code in pool.map(probe, sample):
            if not ok:
                bad += 1
                print(f"  STILL-REFERENCED OBJECT BROKEN: {k} status={code}", file=sys.stderr)
    print(f"post-delete spot check: {len(sample)-bad}/{len(sample)} referenced objects still serve")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
