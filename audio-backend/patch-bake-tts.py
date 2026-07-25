#!/usr/bin/env python3
"""Apply the R2 audio-store change to a content repo's bake-tts.py and workflow.

Every repo carries its own near-identical copy of bake-tts.py, so the same
four edits have to land 32 times. Doing that by hand invites a silent typo in
repo #19; this makes it mechanical and idempotent.

    ./patch-bake-tts.py ~/Desktop/repos/mental-models            # patch
    ./patch-bake-tts.py ~/Desktop/repos/mental-models --check    # report only

Edits:
  bake-tts.py                 LocalStore/R2Store + make_store(); process_page
                              takes a store; the mp3_path block uses it
  .github/workflows/*.yml     install boto3, pass R2_* secrets, stop committing
                              audio/
  .gitignore                  ignore audio/

Refuses rather than guesses: if an anchor isn't found exactly once, nothing is
written and the repo is reported as needing a look. Re-running on an already
patched repo is a no-op.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent.resolve()

STORE_BLOCK = '''# ---------------------------------------------------------------------------
# Where baked MP3s go.
#
# Historically: audio/<lang>/<hash>.mp3, committed to the repo. That put ~8GB
# of binaries across the fleet into git and pushed the biggest sites toward the
# 1GB GitHub Pages limit. Migrated repos upload to R2 instead (bucket key
# <repo>/<lang>/<hash>.mp3, served by the bigcat-audio Worker) and stop
# tracking audio/ entirely.
#
# R2 mode switches on when the three R2_* env vars are present, so a local run
# without credentials still bakes to disk and behaves exactly as before.
# ---------------------------------------------------------------------------


class LocalStore:
    """Baked MP3s as files under audio/<lang>/."""

    label = "local audio/"

    def __init__(self, root: Path):
        self.root = root

    def has(self, lang: str, digest: str) -> bool:
        return (self.root / lang / f"{digest}.mp3").exists()

    def put(self, lang: str, digest: str, data: bytes) -> None:
        p = self.root / lang / f"{digest}.mp3"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


class R2Store:
    """Baked MP3s as R2 objects under <prefix>/<lang>/<hash>.mp3.

    The existing keys are listed once up front: the bake is idempotent by
    "does this object already exist", and one paginated LIST is far cheaper
    than a HEAD per segment.
    """

    def __init__(self, account_id: str, access_key: str, secret_key: str,
                 bucket: str, prefix: str):
        import boto3  # imported lazily so local runs need no extra dep
        from botocore.config import Config

        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.label = f"r2://{bucket}/{self.prefix}"
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 5}),
        )
        self.existing = self._list_existing()
        print(f"  {self.label}: {len(self.existing)} objects already baked")

    def _list_existing(self) -> set:
        keys = set()
        token = None
        while True:
            kw = {"Bucket": self.bucket, "Prefix": self.prefix + "/"}
            if token:
                kw["ContinuationToken"] = token
            resp = self.client.list_objects_v2(**kw)
            for o in resp.get("Contents", []):
                keys.add(o["Key"])
            if not resp.get("IsTruncated"):
                return keys
            token = resp["NextContinuationToken"]

    def _key(self, lang: str, digest: str) -> str:
        return f"{self.prefix}/{lang}/{digest}.mp3"

    def has(self, lang: str, digest: str) -> bool:
        return self._key(lang, digest) in self.existing

    def put(self, lang: str, digest: str, data: bytes) -> None:
        key = self._key(lang, digest)
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType="audio/mpeg",
            # Content-addressed keys, so the bytes behind one never change.
            CacheControl="public, max-age=31536000, immutable",
        )
        self.existing.add(key)


def make_store() -> LocalStore | R2Store:
    env = {k: os.environ.get(k) for k in
           ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")}
    if not all(env.values()):
        if any(env.values()):
            missing = [k for k, v in env.items() if not v]
            print(f"WARNING: partial R2 config, baking to disk instead. "
                  f"Missing: {', '.join(missing)}", file=sys.stderr)
        return LocalStore(AUDIO_DIR)
    return R2Store(
        env["R2_ACCOUNT_ID"], env["R2_ACCESS_KEY_ID"], env["R2_SECRET_ACCESS_KEY"],
        os.environ.get("R2_BUCKET", "bigcat-audio"),
        os.environ.get("R2_PREFIX", REPO_DIR.name),
    )


'''

DOC_ANCHOR = '    AZURE_VOICE_ID_EN       optional  English voice; if absent, EN baking skipped'
DOC_ADD = '''

    R2_ACCOUNT_ID           optional  set all three to upload MP3s to R2 instead
    R2_ACCESS_KEY_ID        optional  of writing audio/ (see make_store below);
    R2_SECRET_ACCESS_KEY    optional  needs `pip install boto3`
    R2_BUCKET               optional  default "bigcat-audio"
    R2_PREFIX               optional  default = this repo's directory name'''

SIG_OLD = '''    langs: set,
    dry_run: bool,
) -> None:'''
SIG_NEW = '''    langs: set,
    dry_run: bool,
    store,
) -> None:'''

BAKE_OLD = '''            mp3_path = AUDIO_DIR / lang / f"{digest}.mp3"
            label = (anchor.get_text() or "(cover)")[:20]
            if mp3_path.exists():'''
BAKE_NEW = '''            label = (anchor.get_text() or "(cover)")[:20]
            if store.has(lang, digest):'''

WRITE_OLD = '''                audio = synth_long(key, region, voice, text)
                mp3_path.parent.mkdir(parents=True, exist_ok=True)
                mp3_path.write_bytes(audio)'''
WRITE_NEW = '''                audio = synth_long(key, region, voice, text)
                store.put(lang, digest, audio)'''

CALL_OLD = '''    for path in files:
        try:
            process_page(path, key, region, voice_zh, voice_en, langs, args.dry_run)'''
CALL_NEW = '''    store = make_store()
    print(f"Audio store: {store.label}")

    for path in files:
        try:
            process_page(path, key, region, voice_zh, voice_en, langs, args.dry_run, store)'''

GITIGNORE = '''# Baked TTS MP3s live in R2 (bucket bigcat-audio, prefix {repo}/),
# served by the bigcat-audio Worker. A local bake without R2_* credentials
# still writes them here — they must never be committed again.
audio/
'''


def sub_once(text: str, old: str, new: str, what: str, problems: list) -> str:
    n = text.count(old)
    if n != 1:
        problems.append(f"{what}: expected 1 match, found {n}")
        return text
    return text.replace(old, new)


def patch_script(path: Path, problems: list) -> str | None:
    src = path.read_text(encoding="utf-8")
    if "class R2Store" in src:
        return None                                  # already patched
    if "def hash_text" not in src:
        problems.append("bake-tts.py: no def hash_text anchor")
        return None
    out = sub_once(src, DOC_ANCHOR, DOC_ANCHOR + DOC_ADD, "docstring env block", problems)
    out = sub_once(out, "def hash_text", STORE_BLOCK + "def hash_text", "store block", problems)
    out = sub_once(out, SIG_OLD, SIG_NEW, "process_page signature", problems)
    out = sub_once(out, BAKE_OLD, BAKE_NEW, "mp3_path existence check", problems)
    out = sub_once(out, WRITE_OLD, WRITE_NEW, "mp3 write", problems)
    out = sub_once(out, CALL_OLD, CALL_NEW, "process_page call", problems)
    return None if problems else out


def patch_workflow(path: Path, repo_name: str, problems: list) -> str | None:
    src = path.read_text(encoding="utf-8")
    if "R2_SECRET_ACCESS_KEY" in src:
        return None                                  # already patched
    out = src
    m = re.search(r'^(\s*)run: pip install (.+)$', out, re.M)
    if not m:
        problems.append("workflow: no `pip install` line")
        return None
    if "boto3" not in m.group(2):
        out = out[:m.start()] + f"{m.group(1)}run: pip install {m.group(2).rstrip()} boto3" + out[m.end():]

    anchor = re.search(r'^(\s*)# AZURE_VOICE_ID_EN unset.*$', out, re.M)
    if not anchor:
        anchor = re.search(r'^(\s*)AZURE_VOICE_ID(_EN)?:.*$', out, re.M)
    if not anchor:
        problems.append("workflow: no Azure env anchor to attach R2 secrets to")
        return None
    ind = anchor.group(1)
    block = (f"\n{ind}# With these three set, MP3s go to R2 instead of audio/ — that's what\n"
             f"{ind}# keeps this repo (and its Pages site) small. Drop them and the bake\n"
             f"{ind}# silently falls back to writing files that nothing will commit.\n"
             f"{ind}R2_ACCOUNT_ID: ${{{{ secrets.R2_ACCOUNT_ID }}}}\n"
             f"{ind}R2_ACCESS_KEY_ID: ${{{{ secrets.R2_ACCESS_KEY_ID }}}}\n"
             f"{ind}R2_SECRET_ACCESS_KEY: ${{{{ secrets.R2_SECRET_ACCESS_KEY }}}}\n"
             f"{ind}R2_PREFIX: {repo_name}")
    out = out[:anchor.end()] + block + out[anchor.end():]

    add = re.search(r'^(\s*)git add audio/ (.+)$', out, re.M)
    if not add:
        problems.append("workflow: no `git add audio/` line")
        return None
    out = (out[:add.start()]
           + f"{add.group(1)}# Audio lives in R2 now; only the data-tts hashes written back\n"
             f"{add.group(1)}# into the HTML get committed.\n"
             f"{add.group(1)}git add {add.group(2)}"
           + out[add.end():])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", type=Path)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    repo = args.repo.expanduser().resolve()
    script = repo / "bake-tts.py"
    if not script.exists():
        sys.exit(f"ERROR: {script} not found")
    wfs = sorted((repo / ".github" / "workflows").glob("bake*.yml"))
    if len(wfs) != 1:
        sys.exit(f"ERROR: expected exactly one bake workflow, found {[w.name for w in wfs]}")

    problems: list[str] = []
    new_script = patch_script(script, problems)
    new_wf = patch_workflow(wfs[0], repo.name, problems)

    if problems:
        print(f"{repo.name}: NOT patched —")
        for p in problems:
            print(f"  - {p}")
        return 1

    todo = []
    if new_script: todo.append("bake-tts.py")
    if new_wf: todo.append(wfs[0].name)
    gi = repo / ".gitignore"
    need_gi = not gi.exists() or "audio/" not in gi.read_text()
    if need_gi: todo.append(".gitignore")

    if not todo:
        print(f"{repo.name}: already patched")
        return 0
    if args.check:
        print(f"{repo.name}: would patch {', '.join(todo)}")
        return 0

    if new_script:
        import ast
        ast.parse(new_script)                        # never write a broken script
        script.write_text(new_script, encoding="utf-8")
    if new_wf:
        wfs[0].write_text(new_wf, encoding="utf-8")
    if need_gi:
        existing = gi.read_text() if gi.exists() else ""
        gi.write_text(existing + ("\n" if existing and not existing.endswith("\n") else "")
                      + GITIGNORE.format(repo=repo.name), encoding="utf-8")
    print(f"{repo.name}: patched {', '.join(todo)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
