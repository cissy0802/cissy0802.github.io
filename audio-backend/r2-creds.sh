#!/usr/bin/env bash
# One local home for the R2 credentials, so every future repo reuses them
# instead of re-creating a token.
#
# Stored in the macOS Keychain (service "bigcat-r2"), not a dotfile: encrypted
# at rest, survives repo deletion, and can't be committed by accident.
#
#   ./r2-creds.sh save                       store / update the three values
#   ./r2-creds.sh check                      are they stored? (never prints values)
#   ./r2-creds.sh exec -- <cmd> [args...]    run <cmd> with R2_* in its environment
#   ./r2-creds.sh env --print                print export lines (opt-in, for eval)
#
# Prefer `exec` over `env`: it hands the values straight to the child process
# without them ever appearing on a terminal, in a log, or in shell history.
#
#   ./r2-creds.sh exec -- python3 migrate-repo-audio.py ~/Desktop/repos/personal-finance
#   ./r2-creds.sh exec -- ./set-r2-secrets.sh some-new-repo
set -euo pipefail

SERVICE=bigcat-r2
NAMES=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY)

command -v security >/dev/null || { echo "ERROR: macOS 'security' not found"; exit 1; }

get() { security find-generic-password -s "$SERVICE" -a "$1" -w 2>/dev/null || true; }

cmd_save() {
  echo "Storing R2 credentials in the login keychain (service: $SERVICE)."
  echo "Paste each value; nothing is echoed."
  for n in "${NAMES[@]}"; do
    read -rs -p "  $n: " v; echo
    [[ -n "$v" ]] || { echo "ERROR: $n was empty, nothing changed"; exit 1; }
    # -U updates in place if the item already exists.
    security add-generic-password -U -s "$SERVICE" -a "$n" -w "$v" \
      -j "Cloudflare R2 credentials for the BigCat hub audio bucket"
  done
  echo "Saved. Verify with: $0 check"
}

cmd_check() {
  local missing=0
  for n in "${NAMES[@]}"; do
    if [[ -n "$(get "$n")" ]]; then printf '  ✓ %s\n' "$n"; else printf '  ✗ %s (not set)\n' "$n"; missing=1; fi
  done
  [[ $missing == 0 ]] || { echo "Run: $0 save"; exit 1; }
}

# Load into this shell's environment. Fails loudly rather than running a
# command with half the credentials present.
load() {
  for n in "${NAMES[@]}"; do
    local v; v="$(get "$n")"
    [[ -n "$v" ]] || { echo "ERROR: $n not in keychain — run '$0 save'" >&2; exit 1; }
    export "$n=$v"
  done
}

case "${1:-}" in
  save)  cmd_save ;;
  check) cmd_check ;;
  exec)
    shift
    [[ "${1:-}" == "--" ]] && shift
    [[ $# -gt 0 ]] || { echo "usage: $0 exec -- <command> [args...]" >&2; exit 1; }
    load
    exec "$@"
    ;;
  env)
    # Printing is opt-in via an explicit flag. A "is stdout a terminal" check
    # would be worse than nothing here: under `eval "$(...)"`, in a script, or
    # in an agent's tool call stdout is always a pipe, so the guard would pass
    # in precisely the cases where the values end up captured in a log.
    if [[ "${2:-}" != "--print" ]]; then
      echo "Refusing to print secrets without --print." >&2
      echo "Prefer:  $0 exec -- <command>" >&2
      echo "If you really want them in your shell:  eval \"\$($0 env --print)\"" >&2
      exit 1
    fi
    load
    for n in "${NAMES[@]}"; do printf 'export %s=%q\n' "$n" "${!n}"; done
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
