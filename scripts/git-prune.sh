#!/usr/bin/env bash
# Prune stale local topic branches and optional unused worktrees after merges.
#
# Safe by default: dry-run only (local branch/worktree deletion). Still runs
# `git fetch --prune origin` so gone-upstream detection is accurate. Pass
# --apply to delete. Never touches main, the currently checked-out branch,
# branches with open PRs, or dirty worktrees.
#
# Designed to pair with GitHub "Automatically delete head branches" so that
# after a PR merges, `origin/<branch>` disappears and this script can drop the
# matching local branch + sibling worktree.
#
# Usage:
#   ./scripts/git-prune.sh              # dry-run report
#   ./scripts/git-prune.sh --apply      # delete safe local branches
#   ./scripts/git-prune.sh --apply --worktrees
#                                       # also remove clean stale worktrees
#
# Options:
#   --apply       Perform deletions (default is dry-run).
#   --worktrees   Include worktree cleanup candidates / removals.
#   --merged      Also delete locals already merged into main (even if remote
#                 still exists). Off by default — prefer gone-remote cleanup.
#   --yes         Skip the interactive confirmation when --apply is set.
#   -h, --help    Show this help.
#
# See also: scripts/new-worktree.sh, .cursor/rules/agent-git-hygiene.mdc

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

APPLY=0
INCLUDE_WORKTREES=0
INCLUDE_MERGED=0
ASSUME_YES=0
MAIN_REF="main"
PROTECTED_BRANCHES=("main" "master")

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

section() {
  printf '\n==> %s\n' "$*"
}

is_protected() {
  local branch="$1"
  local p
  for p in "${PROTECTED_BRANCHES[@]}"; do
    if [[ "${branch}" == "${p}" ]]; then
      return 0
    fi
  done
  return 1
}

current_branch() {
  git branch --show-current 2>/dev/null || true
}

branch_has_open_pr() {
  local branch="$1"
  array_contains "${branch}" "${OPEN_PR_BRANCHES[@]+"${OPEN_PR_BRANCHES[@]}"}"
}

load_open_pr_branches() {
  OPEN_PR_BRANCHES=()
  local heads
  # One network call for the whole repo. On failure, refuse to delete anything
  # that still has a remote check — mark open-PR gating as "unknown".
  if ! heads="$(gh pr list --state open --limit 500 --json headRefName --jq '.[].headRefName' 2>/dev/null)"; then
    OPEN_PR_LOOKUP_FAILED=1
    return
  fi
  OPEN_PR_LOOKUP_FAILED=0
  while IFS= read -r head; do
    [[ -n "${head}" ]] && OPEN_PR_BRANCHES+=("${head}")
  done <<<"${heads}" || true
}

open_pr_blocks_delete() {
  local branch="$1"
  if [[ "${OPEN_PR_LOOKUP_FAILED}" -eq 1 ]]; then
    return 0
  fi
  branch_has_open_pr "${branch}"
}

# Cache worktree porcelain once; look up branch → path with awk (bash 3.2-safe).
WORKTREE_PORCELAIN_CACHE=""
load_branch_worktree_paths() {
  WORKTREE_PORCELAIN_CACHE="$(git worktree list --porcelain; printf '\n')"
}

worktree_path_for_branch() {
  local branch="$1"
  awk -v want="refs/heads/${branch}" '
    $1 == "worktree" { path = $2 }
    $1 == "branch" && $2 == want { found = path }
    END { if (found != "") print found }
  ' <<<"${WORKTREE_PORCELAIN_CACHE}"
}

branch_is_gone() {
  local branch="$1"
  local track
  track="$(git for-each-ref --format='%(upstream:track)' "refs/heads/${branch}")"
  [[ "${track}" == "[gone]" ]]
}

has_meaningful_status() {
  local path="$1"
  local status
  status="$(git -C "${path}" status --porcelain --untracked-files=normal 2>/dev/null || echo "??")"
  [[ -n "${status}" ]]
}

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "${item}" == "${needle}" ]]; then
      return 0
    fi
  done
  return 1
}

confirm_apply() {
  if [[ "${ASSUME_YES}" -eq 1 ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    die "refusing --apply without a TTY; re-run with --yes for non-interactive use"
  fi
  printf 'Apply the deletions above? [y/N] '
  local answer
  read -r answer
  [[ "${answer}" == "y" || "${answer}" == "Y" || "${answer}" == "yes" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --worktrees) INCLUDE_WORKTREES=1 ;;
    --merged) INCLUDE_MERGED=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help) usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "not inside a git repository"
fi

COMMON_DIR="$(git rev-parse --git-common-dir)"
if [[ "${COMMON_DIR}" != /* ]]; then
  COMMON_DIR="$(cd "${ROOT_DIR}/${COMMON_DIR}" && pwd)"
fi
PRIMARY_ROOT="$(dirname "${COMMON_DIR}")"
if [[ "$(pwd -P)" != "$(cd "${PRIMARY_ROOT}" && pwd -P)" ]]; then
  info "Note: running prune from ${ROOT_DIR}"
  info "      (repo common dir: ${PRIMARY_ROOT})"
fi

CURRENT="$(current_branch)"
MODE="dry-run"
if [[ "${APPLY}" -eq 1 ]]; then
  MODE="apply"
fi

info "git-prune (${MODE}) — base=${MAIN_REF}, current=${CURRENT:-detached}"

section "Fetch + prune remote-tracking refs"
git fetch --prune origin
info "  pruned remote-tracking branches that no longer exist on origin"

section "Open PR heads (safety gate)"
declare -a OPEN_PR_BRANCHES=()
OPEN_PR_LOOKUP_FAILED=0
load_open_pr_branches
if [[ "${OPEN_PR_LOOKUP_FAILED}" -eq 1 ]]; then
  info "  gh unavailable — will skip branch deletes and stale worktree removals"
else
  info "  ${#OPEN_PR_BRANCHES[@]} open PR head(s)"
fi

load_branch_worktree_paths

# --- Local branches whose upstream is gone ---------------------------------

declare -a GONE_BRANCHES=()
declare -a GONE_SKIPPED=()

section "Local branches with deleted upstream (gone)"
while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  # Strip leading markers ("*", "+", " ") from `git branch -vv`.
  branch="$(sed -E 's/^[*+ ]*//' <<<"${line}" | awk '{print $1}')"
  [[ -z "${branch}" ]] && continue

  if is_protected "${branch}"; then
    GONE_SKIPPED+=("${branch} (protected)")
    continue
  fi
  if [[ -n "${CURRENT}" && "${branch}" == "${CURRENT}" ]]; then
    GONE_SKIPPED+=("${branch} (checked out here)")
    continue
  fi
  wt_path="$(worktree_path_for_branch "${branch}")"
  if [[ -n "${wt_path}" ]]; then
    if has_meaningful_status "${wt_path}"; then
      GONE_SKIPPED+=("${branch} (dirty worktree: ${wt_path})")
      continue
    fi
    if [[ "${INCLUDE_WORKTREES}" -eq 0 ]]; then
      GONE_SKIPPED+=("${branch} (has worktree; re-run with --worktrees)")
      continue
    fi
  fi
  if open_pr_blocks_delete "${branch}"; then
    if [[ "${OPEN_PR_LOOKUP_FAILED}" -eq 1 ]]; then
      GONE_SKIPPED+=("${branch} (gh unavailable)")
    else
      GONE_SKIPPED+=("${branch} (open PR)")
    fi
    continue
  fi
  GONE_BRANCHES+=("${branch}")
done < <(git branch -vv | grep ': gone]' || true) || true

if [[ ${#GONE_BRANCHES[@]} -eq 0 ]]; then
  info "  (none)"
else
  for b in "${GONE_BRANCHES[@]}"; do
    info "  delete  ${b}"
  done
fi
if [[ ${#GONE_SKIPPED[@]} -gt 0 ]]; then
  info "  skipped:"
  for s in "${GONE_SKIPPED[@]}"; do
    info "    - ${s}"
  done
fi

# --- Optionally: locals already merged into main ---------------------------

declare -a MERGED_BRANCHES=()
declare -a MERGED_SKIPPED=()

if [[ "${INCLUDE_MERGED}" -eq 1 ]]; then
  section "Local branches merged into ${MAIN_REF}"
  MERGE_BASE="${MAIN_REF}"
  if ! git show-ref --verify --quiet "refs/heads/${MAIN_REF}"; then
    if git show-ref --verify --quiet "refs/remotes/origin/${MAIN_REF}"; then
      MERGE_BASE="origin/${MAIN_REF}"
    else
      die "cannot resolve ${MAIN_REF}"
    fi
  fi

  while IFS= read -r branch; do
    [[ -z "${branch}" ]] && continue
    if is_protected "${branch}"; then
      continue
    fi
    if [[ -n "${CURRENT}" && "${branch}" == "${CURRENT}" ]]; then
      MERGED_SKIPPED+=("${branch} (checked out here)")
      continue
    fi
    if array_contains "${branch}" "${GONE_BRANCHES[@]+"${GONE_BRANCHES[@]}"}"; then
      continue
    fi
    wt_path="$(worktree_path_for_branch "${branch}")"
    if [[ -n "${wt_path}" ]]; then
      if has_meaningful_status "${wt_path}"; then
        MERGED_SKIPPED+=("${branch} (dirty worktree: ${wt_path})")
        continue
      fi
      if [[ "${INCLUDE_WORKTREES}" -eq 0 ]]; then
        MERGED_SKIPPED+=("${branch} (has worktree; re-run with --worktrees)")
        continue
      fi
    fi
    if open_pr_blocks_delete "${branch}"; then
      if [[ "${OPEN_PR_LOOKUP_FAILED}" -eq 1 ]]; then
        MERGED_SKIPPED+=("${branch} (gh unavailable)")
      else
        MERGED_SKIPPED+=("${branch} (open PR)")
      fi
      continue
    fi
    MERGED_BRANCHES+=("${branch}")
  done < <(git branch --merged "${MERGE_BASE}" --format='%(refname:short)') || true

  if [[ ${#MERGED_BRANCHES[@]} -eq 0 ]]; then
    info "  (none)"
  else
    for b in "${MERGED_BRANCHES[@]}"; do
      info "  delete  ${b}"
    done
  fi
  if [[ ${#MERGED_SKIPPED[@]} -gt 0 ]]; then
    info "  skipped:"
    for s in "${MERGED_SKIPPED[@]}"; do
      info "    - ${s}"
    done
  fi
fi

# --- Worktrees whose branch is gone / missing / queued ---------------------

declare -a WORKTREES_TO_REMOVE=()
declare -a WORKTREE_SKIPPED=()

if [[ "${INCLUDE_WORKTREES}" -eq 1 ]]; then
  section "Stale worktrees (branch gone, missing, or queued for delete)"
  primary_path="$(git worktree list --porcelain | awk '
    /^worktree / && !seen { print $2; seen = 1 }
  ')"

  path=""
  branch_ref=""
  flush_worktree_entry() {
    if [[ -z "${path}" || "${path}" == "${primary_path}" ]]; then
      path=""
      branch_ref=""
      return
    fi

    local branch="${branch_ref#refs/heads/}"
    local stale=0

    if [[ -z "${branch_ref}" ]]; then
      # Detached secondary worktrees are unusual; skip rather than delete.
      WORKTREE_SKIPPED+=("${path} (detached HEAD — inspect manually)")
      path=""
      branch_ref=""
      return
    fi

    if ! git show-ref --verify --quiet "${branch_ref}"; then
      stale=1
    elif branch_is_gone "${branch}"; then
      stale=1
    elif array_contains "${branch}" \
      "${GONE_BRANCHES[@]+"${GONE_BRANCHES[@]}"}" \
      "${MERGED_BRANCHES[@]+"${MERGED_BRANCHES[@]}"}"; then
      stale=1
    fi

    if [[ "${stale}" -eq 1 ]]; then
      if has_meaningful_status "${path}"; then
        WORKTREE_SKIPPED+=("${path} (dirty; branch=${branch})")
      elif open_pr_blocks_delete "${branch}"; then
        if [[ "${OPEN_PR_LOOKUP_FAILED}" -eq 1 ]]; then
          WORKTREE_SKIPPED+=("${path} (gh unavailable; branch=${branch})")
        else
          WORKTREE_SKIPPED+=("${path} (open PR; branch=${branch})")
        fi
      else
        WORKTREES_TO_REMOVE+=("${path}|${branch}")
      fi
    fi

    path=""
    branch_ref=""
  }

  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ -z "${line}" ]]; then
      flush_worktree_entry
      continue
    fi
    case "${line}" in
      worktree\ *)
        # Starting a new entry without a blank line — flush previous.
        if [[ -n "${path}" ]]; then
          flush_worktree_entry
        fi
        path="${line#worktree }"
        branch_ref=""
        ;;
      branch\ *)
        branch_ref="${line#branch }"
        ;;
    esac
  done < <(git worktree list --porcelain; printf '\n')

  if [[ ${#WORKTREES_TO_REMOVE[@]} -eq 0 ]]; then
    info "  (none)"
  else
    for entry in "${WORKTREES_TO_REMOVE[@]}"; do
      info "  remove  ${entry%%|*}  (branch ${entry##*|})"
    done
  fi
  if [[ ${#WORKTREE_SKIPPED[@]} -gt 0 ]]; then
    info "  skipped:"
    for s in "${WORKTREE_SKIPPED[@]}"; do
      info "    - ${s}"
    done
  fi
fi

# --- Summary / apply -------------------------------------------------------

total_branches=$((${#GONE_BRANCHES[@]} + ${#MERGED_BRANCHES[@]}))
total_worktrees=${#WORKTREES_TO_REMOVE[@]}

section "Summary"
info "  branches to delete:  ${total_branches}"
if [[ "${INCLUDE_WORKTREES}" -eq 1 ]]; then
  info "  worktrees to remove: ${total_worktrees}"
fi

if [[ "${APPLY}" -eq 0 ]]; then
  info ""
  info "Dry-run only. Re-run with --apply to delete."
  if [[ "${INCLUDE_WORKTREES}" -eq 0 && ${#GONE_SKIPPED[@]} -gt 0 ]]; then
    info "Tip: add --worktrees to also clear clean worktrees for gone branches."
  fi
  exit 0
fi

if [[ "${total_branches}" -eq 0 && "${total_worktrees}" -eq 0 ]]; then
  info "Nothing to delete."
  exit 0
fi

info ""
if ! confirm_apply; then
  info "Aborted."
  exit 1
fi

section "Applying"

for entry in "${WORKTREES_TO_REMOVE[@]+"${WORKTREES_TO_REMOVE[@]}"}"; do
  [[ -z "${entry:-}" ]] && continue
  wt_path="${entry%%|*}"
  info "  worktree remove ${wt_path}"
  if git worktree remove "${wt_path}" 2>/dev/null; then
    :
  elif git worktree remove --force "${wt_path}"; then
    info "    (removed with --force)"
  else
    die "worktree remove failed: ${wt_path}"
  fi
done
if [[ ${#WORKTREES_TO_REMOVE[@]} -gt 0 ]]; then
  git worktree prune
fi

for branch in "${GONE_BRANCHES[@]+"${GONE_BRANCHES[@]}"}" "${MERGED_BRANCHES[@]+"${MERGED_BRANCHES[@]}"}"; do
  [[ -z "${branch:-}" ]] && continue
  # Prefer soft delete; fall back to -D for squash-merged / gone upstreams
  # where the tip commit is not an ancestor of main.
  if git branch -d "${branch}" 2>/dev/null; then
    info "  deleted ${branch}"
  elif git branch -D "${branch}"; then
    info "  deleted ${branch} (-D; squash-merged / gone upstream)"
  else
    info "  FAILED  ${branch}" >&2
  fi
done

section "Done"
info "  remaining locals: $(git branch --format='%(refname:short)' | wc -l | tr -d ' ')"
info "  worktrees:        $(git worktree list | wc -l | tr -d ' ')"
