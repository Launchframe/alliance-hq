#!/usr/bin/env bash
# List or delete non-protected Neon database branches.
#
# Safe by default: dry-run only. Never deletes the project's default/primary
# branch, Neon-protected branches, or names in the keep list (main, production,
# vercel-dev by default).
#
# Auth (env):
#   NEON_API_KEY      Neon API key (required)
#   NEON_PROJECT_ID   Neon project id (required)
#
# Usage:
#   ./scripts/neon-prune.sh                 # dry-run report
#   ./scripts/neon-prune.sh --apply         # delete candidates (prompts)
#   ./scripts/neon-prune.sh --apply --yes   # delete without prompt
#   ./scripts/neon-prune.sh --keep staging  # also keep named branch(es)
#
# Pair with .github/workflows/neon-preview-cleanup.yml (PR close + workflow_dispatch).
# See: docs/deploy-frontline-gay.md §2c, https://neon.com/docs/guides/vercel-branch-cleanup

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

APPLY=0
ASSUME_YES=0
API_HOST="${NEON_API_HOST:-https://console.neon.tech/api/v2}"
# Always keep these names even if Neon does not mark them protected/default.
KEEP_NAMES=("main" "production" "vercel-dev")

usage() {
  awk '
    NR == 1 { next }
    /^#/ { sub(/^# ?/, ""); print; next }
    { exit }
  ' "$0"
  exit 0
}

die() {
  echo "error: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --yes) ASSUME_YES=1 ;;
    --keep)
      shift
      [[ $# -gt 0 ]] || die "--keep requires a branch name"
      KEEP_NAMES+=("$1")
      ;;
    -h|--help) usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

PROJECT_ID="${NEON_PROJECT_ID:-}"
API_KEY="${NEON_API_KEY:-}"

[[ -n "${PROJECT_ID}" ]] || die "NEON_PROJECT_ID is required"
[[ -n "${API_KEY}" ]] || die "NEON_API_KEY is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

MODE="dry-run"
if [[ "${APPLY}" -eq 1 ]]; then
  MODE="apply"
fi

info "neon-prune (${MODE}) — project=${PROJECT_ID}"

KEEP_CSV="$(IFS=,; echo "${KEEP_NAMES[*]}")"

branches_json="$(
  curl -fsS \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${API_KEY}" \
    "${API_HOST}/projects/${PROJECT_ID}/branches?limit=10000"
)" || die "failed to list Neon branches"

# Classify keep vs delete. Emits TSV: action\tid\tname\treason
classify="$(
  NEON_KEEP_NAMES="${KEEP_CSV}" python3 -c '
import json, os, sys

data = json.load(sys.stdin)
branches = data.get("branches") or []
keep_names = {
    n.strip().lower()
    for n in os.environ.get("NEON_KEEP_NAMES", "").split(",")
    if n.strip()
}

for b in sorted(branches, key=lambda x: (x.get("name") or "").lower()):
    name = b.get("name") or ""
    bid = b.get("id") or ""
    if not name or not bid:
        continue
    reasons = []
    if b.get("default") is True:
        reasons.append("default")
    if b.get("primary") is True:
        reasons.append("primary")
    if b.get("protected") is True:
        reasons.append("protected")
    if name.lower() in keep_names:
        reasons.append("keep-list")
    if reasons:
        print("keep\t%s\t%s\t%s" % (bid, name, ",".join(reasons)))
    else:
        print("delete\t%s\t%s\t" % (bid, name))
' <<<"${branches_json}"
)"

declare -a DELETE_IDS=()
declare -a DELETE_NAMES=()
declare -a KEEP_LINES=()

while IFS=$'\t' read -r action bid name reason; do
  [[ -z "${action:-}" ]] && continue
  if [[ "${action}" == "keep" ]]; then
    KEEP_LINES+=("${name} (${reason})")
  elif [[ "${action}" == "delete" ]]; then
    DELETE_IDS+=("${bid}")
    DELETE_NAMES+=("${name}")
  fi
done <<<"${classify}"

info ""
info "==> Keeping (${#KEEP_LINES[@]})"
if [[ ${#KEEP_LINES[@]} -eq 0 ]]; then
  info "  (none — unexpected; aborting)"
  die "no keep candidates; refusing to continue"
fi
for line in "${KEEP_LINES[@]}"; do
  info "  keep    ${line}"
done

info ""
info "==> Candidates to delete (${#DELETE_NAMES[@]})"
if [[ ${#DELETE_NAMES[@]} -eq 0 ]]; then
  info "  (none)"
else
  for name in "${DELETE_NAMES[@]}"; do
    info "  delete  ${name}"
  done
fi

info ""
info "Summary: keep=${#KEEP_LINES[@]} delete=${#DELETE_NAMES[@]}"

if [[ "${APPLY}" -eq 0 ]]; then
  info ""
  info "Dry-run only. Re-run with --apply to delete."
  exit 0
fi

if [[ ${#DELETE_NAMES[@]} -eq 0 ]]; then
  info "Nothing to delete."
  exit 0
fi

if [[ "${ASSUME_YES}" -ne 1 ]]; then
  if [[ ! -t 0 ]]; then
    die "refusing --apply without a TTY; re-run with --yes for non-interactive use"
  fi
  printf 'Delete %d Neon branch(es)? [y/N] ' "${#DELETE_NAMES[@]}"
  read -r answer
  case "${answer}" in
    y|Y|yes) ;;
    *) info "Aborted."; exit 1 ;;
  esac
fi

info ""
info "==> Deleting"
failed=0
for i in "${!DELETE_IDS[@]}"; do
  bid="${DELETE_IDS[$i]}"
  name="${DELETE_NAMES[$i]}"
  http_code="$(
    curl -sS -o /tmp/neon-prune-delete.json -w '%{http_code}' \
      -X DELETE \
      -H "Accept: application/json" \
      -H "Authorization: Bearer ${API_KEY}" \
      "${API_HOST}/projects/${PROJECT_ID}/branches/${bid}"
  )" || http_code="000"
  # 200 deleted; 204/404 already gone (per Neon API docs).
  if [[ "${http_code}" == "200" || "${http_code}" == "204" || "${http_code}" == "404" ]]; then
    if [[ "${http_code}" == "404" ]]; then
      info "  already gone ${name} (404)"
    else
      info "  deleted ${name} (${http_code})"
    fi
  else
    info "  FAILED  ${name} (HTTP ${http_code})" >&2
    failed=1
  fi
done

if [[ "${failed}" -ne 0 ]]; then
  die "one or more deletes failed"
fi

info ""
info "Done."
