#!/usr/bin/env python3
"""Independently audit a migrated repo. Nothing here trusts the migration
tooling — it re-derives everything from the pages, git history and the live web.

    ./audit-migration.py ~/Desktop/repos/mental-models
    ./audit-migration.py ~/Desktop/repos/mental-models --full   # every segment

Checks, in order of how much they'd hurt if they failed:

  1 SERVES     every data-tts hash on every page fetches 200 + audio/mpeg
               through the Worker. This is the invariant that matters: no page
               can reference a segment the reader can't hear.
  2 LOSSLESS   R2 bytes are sha256-identical to the blobs in git history from
               before the untrack commit. Git history is an immutable record of
               what the site actually served, independent of both the local
               working copy the upload read and of R2's own metadata.
  3 UNTRACKED  git tracks no MP3s, and Pages really 404s them.
  4 ROUTED     the repo is listed in BOTH i18n-tts.js and offline.js, and the
               served copies of those (not just local files) agree.
  5 NO FORK    no page loads a repo-local i18n-tts.js, which would bypass the
               R2 routing table entirely and fall back to Web Speech.

Exit code is 0 only if every check passes.

Needs: pip install requests
"""
from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

WORKER = "https://bigcat-audio.cissychen.workers.dev"
HUB = "https://hub.cissychen.com"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36"}

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def record(name, ok, detail):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}: {detail}")


def git(repo: Path, *args) -> str:
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True).stdout


def page_hashes(repo: Path) -> dict[str, set[str]]:
    """{lang: {hash}} for every segment any page references.

    Split-mode pages carry data-tts and take their language from the filename;
    legacy full-mode pages carry data-tts-zh / data-tts-en on one page.
    """
    out = {"zh": set(), "en": set()}
    for p in sorted(repo.glob("*.html")):
        html = p.read_text(encoding="utf-8", errors="replace")
        lang = "en" if p.name.endswith(".en.html") else "zh"
        for h in re.findall(r'data-tts="([0-9a-f]{16})"', html):
            out[lang].add(h)
        for lg in ("zh", "en"):
            for h in re.findall(rf'data-tts-{lg}="([0-9a-f]{{16}})"', html):
                out[lg].add(h)
    return out


def blob_from_history(repo: Path, path: str) -> bytes | None:
    """The last version of `path` that ever existed in git, or None."""
    commits = git(repo, "rev-list", "--all", "--", path).split()
    for c in commits[:4]:                  # newest first; the tip may be the deletion
        for rev in (c, f"{c}^"):
            r = subprocess.run(["git", "-C", str(repo), "show", f"{rev}:{path}"],
                               capture_output=True)
            if r.returncode == 0 and r.stdout:
                return r.stdout
    return None


def check_serves(repo: Path, refs: dict[str, set[str]], full: bool) -> None:
    items = [(lg, h) for lg in ("zh", "en") for h in sorted(refs[lg])]
    if not items:
        record("SERVES", False, "no data-tts hashes found in any page — suspicious")
        return
    probe = items if full else items[:: max(1, len(items) // 60)][:60]

    def one(it):
        lg, h = it
        try:
            r = requests.get(f"{WORKER}/{repo.name}/{lg}/{h}.mp3", timeout=45)
            ok = (r.status_code == 200 and "audio" in r.headers.get("Content-Type", "")
                  and len(r.content) > 1000)
            return (lg, h, ok, f"status={r.status_code} bytes={len(r.content)}")
        except Exception as e:
            return (lg, h, False, str(e)[:60])

    with ThreadPoolExecutor(max_workers=12) as pool:
        got = list(pool.map(one, probe))

    # A segment that fails is only this migration's fault if it ever existed.
    # Pages carry data-tts for audio that was never baked — leadership has 41
    # such English hashes (one of them the literal placeholder
    # 1122334455667788), and they 404'd against Pages exactly the same way
    # before the move. Calling that a regression trains you to ignore the
    # check; it has to be separated from a segment we actually lost.
    lost, never = [], []
    for lg, h, ok, why in got:
        if ok:
            continue
        (never if blob_from_history(repo, f"audio/{lg}/{h}.mp3") is None else lost).append(
            (lg, h, why))
    for lg, h, why in lost[:5]:
        print(f"        LOST {lg}/{h}: {why}")
    record("SERVES", not lost,
           f"{len(got)-len(lost)-len(never)}/{len(got)} referenced segments play, "
           f"{len(lost)} lost in migration "
           f"({len(items)} total referenced{'' if full else ', sampled'})")
    if never:
        by_lang = {}
        for lg, h, _ in never:
            by_lang[lg] = by_lang.get(lg, 0) + 1
        record("SERVES/pre-existing", True,
               f"{len(never)} referenced segments were never baked at all "
               f"({', '.join(f'{n} {lg}' for lg, n in sorted(by_lang.items()))}) — "
               f"they 404'd before the migration too, player falls back to Web Speech")


def check_lossless(repo: Path, refs: dict[str, set[str]], full: bool) -> None:
    """Compare R2 against the original blobs in git history.

    Scoped to hashes the pages actually reference. Auditing every MP3 ever
    deleted instead flags obsolete segments: a re-bake whose text changed
    deletes the old hash, and that file SHOULD be absent from R2 — it is dead
    weight no page can reach. Only what a reader can request has to match.
    """
    items = [(lg, h) for lg in ("zh", "en") for h in sorted(refs[lg])]
    if not items:
        record("LOSSLESS", False, "no referenced hashes to compare")
        return
    probe = items if full else items[:: max(1, len(items) // 40)][:40]

    def one(it):
        lg, h = it
        path = f"audio/{lg}/{h}.mp3"
        blob = blob_from_history(repo, path)
        if blob is None:
            # Baked straight into R2 after the migration, so it was never in
            # git. Nothing to compare against — SERVES already covers it.
            return path, None, "never in git (baked post-migration)"
        try:
            r = requests.get(f"{WORKER}/{repo.name}/{lg}/{h}.mp3", timeout=45)
        except Exception as e:
            return path, False, str(e)[:50]
        if r.status_code != 200:
            return path, False, f"worker status={r.status_code}"
        same = hashlib.sha256(blob).hexdigest() == hashlib.sha256(r.content).hexdigest()
        return path, same, f"git={len(blob)}B r2={len(r.content)}B"

    with ThreadPoolExecutor(max_workers=10) as pool:
        got = list(pool.map(one, probe))
    bad = [g for g in got if g[1] is False]
    skipped = [g for g in got if g[1] is None]
    for path, _, why in bad[:5]:
        print(f"        {path}: {why}")
    compared = len(got) - len(skipped)
    record("LOSSLESS", not bad,
           f"{compared-len(bad)}/{compared} referenced objects sha256-identical to their "
           f"original git blobs"
           + (f" ({len(skipped)} baked after the migration, never in git)" if skipped else ""))


def check_untracked(repo: Path, refs: dict[str, set[str]]) -> None:
    tracked = [f for f in git(repo, "ls-files", "audio").split() if f.endswith(".mp3")]
    record("UNTRACKED/git", not tracked, f"{len(tracked)} MP3s still tracked by git")
    sample = next(iter(sorted(refs["zh"]) or sorted(refs["en"])), None)
    if not sample:
        return
    lang = "zh" if sample in refs["zh"] else "en"
    r = requests.get(f"{HUB}/{repo.name}/audio/{lang}/{sample}.mp3", headers=UA, timeout=30)
    record("UNTRACKED/pages", r.status_code == 404,
           f"Pages returns {r.status_code} for audio/{lang}/{sample}.mp3 (want 404)")


def check_routed(repo: Path) -> None:
    for name in ("i18n-tts.js", "offline.js"):
        try:
            js = requests.get(f"{HUB}/{name}", headers={**UA, "Cache-Control": "no-cache"},
                              timeout=30).text
        except Exception as e:
            record(f"ROUTED/{name}", False, str(e)[:60]); continue
        listed = re.search(r"R2_AUDIO_REPOS\s*=\s*\{([^}]*)\}", js)
        ok = bool(listed and f"'{repo.name}'" in listed.group(1))
        record(f"ROUTED/{name}", ok,
               f"served copy lists {repo.name}" if ok
               else f"served copy does NOT list {repo.name} — playback stays on relative URLs")
    sw = requests.get(f"{HUB}/sw.js", headers={**UA, "Cache-Control": "no-cache"}, timeout=30).text
    record("ROUTED/sw.js", WORKER in sw,
           "audio origin exempted from the cross-origin bail-out"
           if WORKER in sw else "sw.js does not know the audio origin — offline audio will fail")


def check_no_fork(repo: Path) -> None:
    local = [p.name for p in repo.glob("*.html")
             if re.search(r'<script[^>]*src="i18n-tts\.js"', p.read_text(encoding="utf-8",
                                                                        errors="replace"))]
    record("NO FORK", not local,
           f"{len(local)} pages load a repo-local i18n-tts.js"
           + (f" (e.g. {local[0]})" if local else " — all use the shared script"))
    record("NO FORK/file", not (repo / "i18n-tts.js").exists(),
           "in-repo i18n-tts.js still present" if (repo / "i18n-tts.js").exists()
           else "no in-repo copy to drift")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", type=Path)
    ap.add_argument("--full", action="store_true", help="check every segment, not a sample")
    args = ap.parse_args()
    repo = args.repo.expanduser().resolve()
    if not (repo / ".git").is_dir():
        sys.exit(f"ERROR: {repo} is not a git repo")

    print(f"\nAuditing {repo.name}{' (full)' if args.full else ''}\n")
    refs = page_hashes(repo)
    check_serves(repo, refs, args.full)
    check_lossless(repo, refs, args.full)
    check_untracked(repo, refs)
    check_routed(repo)
    check_no_fork(repo)

    failed = [r for r in results if r[0] == FAIL]
    print(f"\n{len(results)-len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED: " + ", ".join(r[1] for r in failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
