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
#   ./set-repo-secrets.sh --all linguistics            # R2 trio + Azure pair, one shot
#
# Values resolve per-name, first hit wins: environment -> macOS Keychain
# (service "bigcat-r2", where r2-creds.sh keeps the R2 trio) -> an `export NAME=`
# line in ~/.zshrc (where the Azure pair lives) -> prompt. Nothing is echoed and
# nothing is written to disk. --all exists because a new content repo needs all
# five: miss the Azure pair and every publish turns "Bake TTS Audio" red with
# `ERROR: missing env vars` — the page still ships, just with no audio.
set -euo pipefail

OWNER=cissy0802

# Every repo that ships baked TTS audio. Regenerate with:
#   for d in */; do [ -d "$d/.git" ] && [ -n "$(git -C "$d" ls-files audio)" ] && echo "${d%/}"; done
REPOS=(
  ai-ml art-aesthetics biographies book-recommendations buddhism
  chapter-deepread civics-geopolitics complexity-science cs-papers-deepread
  deep-reading deep-research family-craft health-longevity history investing
  leadership linguistics mathematics mental-models meta-knowledge neuroscience parenting
  evolutionary-biology personal-finance philosophy physics psychology sales sociology-anthropology super-individual
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

# --all = everything a content repo needs to bake and store audio.
if [[ "${1:-}" == "--all" ]]; then
  NAMES=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY AZURE_SPEECH_KEY AZURE_SPEECH_REGION)
  shift
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

# Resolve one secret without ever echoing it: environment, then Keychain, then
# an `export NAME=value` line in ~/.zshrc. Prints only where it came from.
keychain_value() { security find-generic-password -s bigcat-r2 -a "$1" -w 2>/dev/null || true; }
zshrc_value() {
  [[ -r "$HOME/.zshrc" ]] || return 0
  sed -n "s/^[[:space:]]*export[[:space:]]*$1=[\"']\{0,1\}\([^\"']*\)[\"']\{0,1\}[[:space:]]*\$/\1/p" \
      "$HOME/.zshrc" | tail -1
}

need_prompt=()
for n in "${NAMES[@]}"; do
  v="${!n:-}";                         src="environment"
  [[ -n "$v" ]] || { v=$(keychain_value "$n"); src="Keychain(bigcat-r2)"; }
  [[ -n "$v" ]] || { v=$(zshrc_value    "$n"); src="~/.zshrc"; }
  if [[ -n "$v" ]]; then
    echo "  $n <- $src"
    VALUES+=("$v")
  else
    VALUES+=("")
    need_prompt+=("$n")
  fi
  unset v
done

if [[ ${#need_prompt[@]} -gt 0 ]]; then
  # `read` needs a real terminal. Run from a button or a pipe it sees EOF at
  # once and every value comes back empty — which used to be reported as "you
  # typed nothing", sending you to look in the wrong place.
  if [[ ! -t 0 ]]; then
    echo "ERROR: not found anywhere and no terminal to type them: ${need_prompt[*]}"
    echo
    echo "Run this in Terminal.app or iTerm:"
    echo "  cd $(pwd)"
    echo "  $0 --names $(IFS=,; echo "${NAMES[*]}") ${REPOS[*]}"
    echo
    echo "Or export them / store them where this script looks:"
    echo "  R2 trio        ./r2-creds.sh save        (macOS Keychain)"
    echo "  Azure pair     an 'export NAME=...' line in ~/.zshrc"
    exit 1
  fi
  echo "Paste the ones that were not found; nothing is echoed."
  for i in "${!NAMES[@]}"; do
    [[ -n "${VALUES[$i]}" ]] && continue
    read -rs -p "  ${NAMES[$i]}: " v; echo
    [[ -n "$v" ]] || { echo "ERROR: ${NAMES[$i]} was empty — nothing was changed."; exit 1; }
    VALUES[$i]="$v"
    unset v
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
