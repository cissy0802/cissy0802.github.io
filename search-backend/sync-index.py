#!/usr/bin/env python3
"""Sync a built Pagefind bundle into the bigcat-search R2 bucket.

Keys mirror the URL path exactly ("pagefind/fragment/<hash>.pf_fragment"), which
is what lets the Worker map a request to an object without any rewriting.

Used in two places, deliberately the same code so they can't drift:
  CI       .github/workflows/build-search.yml, after Pagefind runs
  locally   ../audio-backend/r2-creds.sh exec -- ./sync-index.py ../pagefind

Credentials come from the environment (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
R2_SECRET_ACCESS_KEY) — never arguments, so they stay out of `ps` and history.

Uploads only what changed (R2's ETag is the MD5 for single-part puts) and
deletes keys that no longer exist locally, so yesterday's fragments don't
accumulate into a bucket nobody prunes.
"""
import concurrent.futures
import hashlib
import mimetypes
import os
import sys

import boto3
from botocore.config import Config

PREFIX = "pagefind/"
WORKERS = 16
TYPES = {".js": "text/javascript", ".css": "text/css", ".json": "application/json"}


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def r2_config():
    """Turn off the integrity checksums R2 rejects — where that's even a thing.

    botocore only grew these knobs in 1.36, which is also the release that
    started sending the checksums by default. The GitHub runner's system
    botocore predates both, and passing the kwargs there is a TypeError, so ask
    for them and accept a plain Config when they don't exist.
    """
    try:
        return Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
    except TypeError:
        return Config()


def content_type(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in TYPES:
        return TYPES[ext]
    # .pf_index / .pf_fragment / .pf_meta / .pagefind are all raw binary
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: sync-index.py <pagefind-bundle-dir>")
    root = os.path.abspath(sys.argv[1])
    if not os.path.isdir(root):
        sys.exit(f"not a directory: {root}")

    try:
        account, key_id, secret = (
            os.environ["R2_ACCOUNT_ID"],
            os.environ["R2_ACCESS_KEY_ID"],
            os.environ["R2_SECRET_ACCESS_KEY"],
        )
    except KeyError as e:
        sys.exit(f"missing env var: {e.args[0]}")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
        config=r2_config(),
    )
    bucket = "bigcat-search"

    local = {}
    for dirpath, _, names in os.walk(root):
        for n in names:
            p = os.path.join(dirpath, n)
            local[PREFIX + os.path.relpath(p, root).replace(os.sep, "/")] = p

    remote = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
        for o in page.get("Contents", []):
            remote[o["Key"]] = o["ETag"].strip('"')

    todo = [k for k, p in local.items() if remote.get(k) != md5(p)]
    stale = [k for k in remote if k not in local]

    def put(key):
        s3.upload_file(
            local[key], bucket, key, ExtraArgs={"ContentType": content_type(key)}
        )

    if todo:
        with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(put, todo))
    # delete_objects takes 1000 keys per call
    for i in range(0, len(stale), 1000):
        s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in stale[i : i + 1000]]},
        )

    print(f"{len(local)} files: {len(todo)} uploaded, {len(stale)} deleted, "
          f"{len(local) - len(todo)} unchanged")


if __name__ == "__main__":
    main()
