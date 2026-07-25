#!/usr/bin/env bash
# Push the three R2 credentials into every content repo's GitHub Actions secrets.
#
# GitHub only supports Actions secrets at the repository or ORGANISATION level,
# and these repos live under a personal account — so there is no single place to
# put them. This loop is the substitute: run it once, not 32 dashboard visits.
#
# Values are read from the terminal (never echoed, never written to disk) and
# piped to `gh` on stdin rather than passed as arguments, so they don't show up
# in `ps` or in shell history.
#
# Usage:
#   ./set-r2-secrets.sh                 # every repo in REPOS below
#   ./set-r2-secrets.sh personal-finance  # just the pilot
#   ./set-r2-secrets.sh --check         # list which repos already have them
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

command -v gh >/dev/null || { echo "ERROR: gh CLI not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: run 'gh auth login' first"; exit 1; }

if [[ "${1:-}" == "--check" ]]; then
  for r in "${REPOS[@]}"; do
    have=$(gh secret list --repo "$OWNER/$r" --json name --jq '.[].name' 2>/dev/null \
           | grep -c '^R2_' || true)
    printf '%-24s %s/3\n' "$r" "$have"
  done
  exit 0
fi

# An explicit repo list overrides the default (handy for the pilot).
if [[ $# -gt 0 ]]; then REPOS=("$@"); fi

echo "Setting ${#NAMES[@]} secrets on ${#REPOS[@]} repo(s) under $OWNER."

# Take the values from the environment when they're already there — that's what
# `r2-creds.sh exec -- ./set-r2-secrets.sh newrepo` does, so onboarding a repo
# months from now needs no retyping and no second token. Otherwise prompt.
VALUES=()
if [[ -n "${R2_ACCOUNT_ID:-}" && -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  echo "Using R2_* from the environment."
  for n in "${NAMES[@]}"; do VALUES+=("${!n}"); done
else
  echo "Paste each value; nothing is echoed. (Store them once with ./r2-creds.sh save)"
  for n in "${NAMES[@]}"; do
    read -rs -p "  $n: " v; echo
    [[ -n "$v" ]] || { echo "ERROR: $n was empty"; exit 1; }
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
  echo "Done — all ${#REPOS[@]} repo(s) set. Verify with: $0 --check"
else
  echo "$fail repo(s) failed. Check you have admin rights on them, then re-run."
  exit 1
fi
