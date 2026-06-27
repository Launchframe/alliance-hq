#!/usr/bin/env bash
# Create a git worktree for parallel/isolated work and copy local secret env
# files (.env.local, etc.) into it.
#
# Why: .env.local and friends are gitignored, so a fresh `git worktree add`
# starts with NO local env — the app/dev server/e2e then run with missing DB
# URLs, auth secrets, and OAuth credentials (symptom: auth/session 500s and
# missing SSO buttons on /auth). This script copies them over so the new
# worktree is immediately runnable.
#
# SECRETS: this script COPIES env files with `cp` only. It never prints, cats,
# greps, or otherwise reads their contents. Agents must follow the same rule
# (see .cursor/rules/agent-git-hygiene.mdc → "Worktree env (.env.local) — copy,
# never read").
#
# Usage:
#   ./scripts/new-worktree.sh <branch> [base-branch]
#
#   <branch>       Topic branch for the worktree. Created if it does not exist.
#   [base-branch]  Base to branch from when <branch> is new.
#                  Default: origin/main (this repo's integration line).
#
# Examples:
#   ./scripts/new-worktree.sh feat/video-review
#   ./scripts/new-worktree.sh fix/session-error origin/main
#
# Worktree dir: ../<repo-name>-<branch-leaf> (sibling of this clone).
# Remove when done:  git worktree remove --force <dir> && git worktree prune

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="$(basename "${ROOT_DIR}")"

# Gitignored local env files copied into every new worktree. Extend as needed;
# keep to files that are safe-to-copy local secrets, not committed config.
ENV_FILES=(".env.local" ".env" ".env.development.local" ".env.production.local")

DEFAULT_BASE="origin/main"

usage() {
  cat >&2 <<'EOF'
Usage:
  new-worktree.sh <branch> [base-branch]

Creates a sibling git worktree and copies local secret env files into it
(.env.local, .env, .env.*.local). Env files are copied, never read.

  <branch>       Topic branch for the worktree (created if missing).
  [base-branch]  Base when <branch> is new (default: origin/main).
EOF
  exit 1
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
fi

BRANCH="$1"
BASE="${2:-${DEFAULT_BASE}}"

if [[ -z "${BRANCH}" ]]; then
  usage
fi

# Worktree directory name: repo + sanitized branch leaf (drop any `feat/` etc.).
BRANCH_LEAF="${BRANCH##*/}"
if [[ "${BRANCH_LEAF}" == "." || "${BRANCH_LEAF}" == ".." ]]; then
  echo "Refusing unsafe worktree directory name derived from branch '${BRANCH}'." >&2
  exit 1
fi
WORKTREE_DIR="$(cd "${ROOT_DIR}/.." && pwd)/${REPO_NAME}-${BRANCH_LEAF}"

if [[ -e "${WORKTREE_DIR}" ]]; then
  echo "Refusing to overwrite existing path: ${WORKTREE_DIR}" >&2
  echo "Pick a different <branch> leaf or remove the stale worktree first." >&2
  exit 1
fi

cd "${ROOT_DIR}"

echo "Fetching origin..."
git fetch origin

# Track an existing branch (local or remote) or create a new one from BASE.
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  echo "Adding worktree for existing local branch '${BRANCH}'"
  git worktree add "${WORKTREE_DIR}" "${BRANCH}"
elif git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  echo "Adding worktree tracking origin/${BRANCH}"
  git worktree add --track -b "${BRANCH}" "${WORKTREE_DIR}" "origin/${BRANCH}"
else
  echo "Creating new branch '${BRANCH}' from '${BASE}'"
  git worktree add -b "${BRANCH}" "${WORKTREE_DIR}" "${BASE}"
fi

# Copy local secret env files. cp only — contents are never read or printed.
echo ""
echo "Copying local env files (copied, not read):"
copied_any=0
for env_file in "${ENV_FILES[@]}"; do
  src="${ROOT_DIR}/${env_file}"
  if [[ -f "${src}" ]]; then
    cp "${src}" "${WORKTREE_DIR}/${env_file}"
    echo "  ✓ ${env_file}"
    copied_any=1
  fi
done
if [[ "${copied_any}" -eq 0 ]]; then
  echo "  (none found in ${REPO_NAME}; the new worktree has no local env)"
fi

echo ""
echo "Worktree ready: ${WORKTREE_DIR}"
echo "  cd ${WORKTREE_DIR}"
echo ""
echo "Remove when done:"
echo "  git worktree remove --force ${WORKTREE_DIR} && git worktree prune"
