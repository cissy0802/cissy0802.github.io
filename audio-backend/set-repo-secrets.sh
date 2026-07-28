#!/usr/bin/env bash
# Push a set of secrets into every content repo's GitHub Actions secrets.
#
# GitHub only supports Actions secrets at the repository or ORGANISATION level,
# and these repos live under a personal account — so there is no single place to
# put them. This loop is the substitute: run it once, not 32 dashboard visits.
#
# It defaults to the R2 trio. --names sets any others: the Azure keys were
# originally rolled out by a one-off script that no longer exists, and
# thinker-arena was missed by it — every new debate went out with no audio for
# days. Anything spread across 33 repos by hand drifts; use --check to find it.
#
# Values are read from the terminal (never echoed, never written to disk) and
# piped to `gh` on stdin rather than passed as arguments, so they don't show up
# in `ps` or in shell history.
#
# Usage:
#   ./set-repo-secrets.sh                              # R2 trio, every repo below
#   ./set-repo-secrets.sh personal-finance             # one repo
#   ./set-repo-secrets.sh --check                      # who already has them
#   ./set-repo-secrets.sh --names AZURE_SPEECH_KEY,AZURE_SPEECH_REGION thinker-arena
#   ./set-repo-secrets.sh --names AZURE_SPEECH_KEY,AZURE_SPEECH_REGION --check
set -euo pipefail

OWNER=cissy0802

# Every repo that ships baked TTS audio. Regenerate with:
#   for d in */; do [ -d "$d/.git" ] && [ -n "$(git -C "$d" ls-files audio)" ] && echo "${d%/}"; done
REPOS=(
  ai-ml art-aesthetics biographies book-recommendations buddhism
  chapter-deepread civics-geopolitics complexity-science cs-papers-deepread
  deep-reading deep-research family-craft health-longevity history investing
  leadership mathematics mental-models meta-knowledge neuroscience parenting
  personal-finance philosophy physics psychology sales super-individual
  synthesis system-design thinker-arena world-religions writing
)

NAMES=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY)

# --names A,B replaces the default set. Parsed before anything else so --check
# reports on the secrets actually asked about.
if [[ "${1:-}" == "--names" ]]; then
  [[ -n "${2:-}" ]] || { echo "ERROR: --names needs a comma-separated list"; exit 1; }
  IFS=',' read -r -a NAMES <<< "$2"
  shift 2
fi

command -v gh >/dev/null || { echo "ERROR: gh CLI not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: run 'gh auth login' first"; exit 1; }

if [[ "${1:-}" == "--check" ]]; then
  for r in "${REPOS[@]}"; do
    listed=$(gh secret list --repo "$OWNER/$r" --json name --jq '.[].name' 2>/dev/null || true)
    have=0
    for n in "${NAMES[@]}"; do
      grep -qx "$n" <<< "$listed" && have=$((have+1))
    done
    flag=""; [[ $have -lt ${#NAMES[@]} ]] && flag="  <-- incomplete"
    printf '%-24s %s/%s%s\n' "$r" "$have" "${#NAMES[@]}" "$flag"
  done
  exit 0
fi

# An explicit repo list overrides the default (handy for the pilot).
if [[ $# -gt 0 ]]; then REPOS=("$@"); fi

echo "Setting ${#NAMES[@]} secret(s) [${NAMES[*]}] on ${#REPOS[@]} repo(s) under $OWNER."

# Take the values from the environment when they're already there — that's what
# `r2-creds.sh exec -- ./set-r2-secrets.sh newrepo` does, so onboarding a repo
# months from now needs no retyping and no second token. Otherwise prompt.
VALUES=()
# Take the values from the environment when they are all already there. That is
# what `r2-creds.sh exec -- ./set-repo-secrets.sh newrepo` does, so onboarding a
# repo months from now needs no retyping and no second token.
from_env=1
for n in "${NAMES[@]}"; do [[ -n "${!n:-}" ]] || from_env=0; done

if [[ $from_env == 1 ]]; then
  echo "Using ${NAMES[*]} from the environment."
  for n in "${NAMES[@]}"; do VALUES+=("${!n}"); done
else
  # `read` needs a real terminal. Run from a button or a pipe it sees EOF at
  # once and every value comes back empty — which used to be reported as "you
  # typed nothing", sending you to look in the wrong place.
  if [[ ! -t 0 ]]; then
    echo "ERROR: no terminal on stdin, so the values cannot be typed."
    echo
    echo "Run this in Terminal.app or iTerm:"
    echo "  cd $(pwd)"
    echo "  $0 --names $(IFS=,; echo "${NAMES[*]}") ${REPOS[*]}"
    echo
    echo "Or, if the values are already exported in your shell, they are used"
    echo "as-is: ${NAMES[*]}"
    exit 1
  fi
  echo "Paste each value; nothing is echoed. (R2 values can be stored once with ./r2-creds.sh save)"
  for n in "${NAMES[@]}"; do
    read -rs -p "  $n: " v; echo
    [[ -n "$v" ]] || { echo "ERROR: $n was empty — nothing was changed."; exit 1; }
    VALUES+=("$v")
  done
fi

fail=0
for r in "${REPOS[@]}"; do
  ok=1
  for i in "${!NAMES[@]}"; do
    if ! printf '%s' "${VALUES[$i]}" | gh secret set "${NAMES[$i]}" --repo "$OWNER/$r" >/dev/null 2>&1; then
      ok=0
    fi
  done
  if [[ $ok == 1 ]]; then echo "  ✓ $r"; else echo "  ✗ $r"; fail=$((fail+1)); fi
done

echo
if [[ $fail == 0 ]]; then
  echo "Done — all ${#REPOS[@]} repo(s) set. Verify with: $0 --check (add --names if you used it)"
else
  echo "$fail repo(s) failed. Check you have admin rights on them, then re-run."
  exit 1
fi
