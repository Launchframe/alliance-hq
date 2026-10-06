# Efficient local validation

This is the canonical gate and efficiency policy for **Devin, Cursor, review agents, and maintainers**. It supersedes older per-PR full-gate instructions in a stacked workflow, including global skills. `AGENTS.md`, `.devin/rules/validation-efficiency.md`, and the Cursor rules point here rather than defining separate gate policies.

GitHub CI is disabled under the Actions credit freeze. Do not wait for missing checks or treat them as passing. Vercel deploys are not the first validation signal or a substitute for local checks. Do not change CI budgets or security controls to make validation faster.

## Always preserve

- No secrets, credentials, `.env.local`, or reference archives in commits. Never inspect or print local secret-file contents.
- User-facing copy follows maintainer approval and en-US/pt-BR rules.
- Non-trivial changes need regression tests. New BFF routes enforce permissions; admin routes require platform maintainer. Keep authorization, tenant-isolation, and negative-permission assertions intact.
- Migrations/seeds remain idempotent. Numbered SQL migrations require journal entries; preserve both sides of migration conflicts and propagate schema/snapshot repairs.
- Work in the primary clone by default, serialize writers/builds, and preserve unrelated work. No automatic stash, worktree, reset, rebase, force-push, or destructive cleanup. Commit/push permission is not PR merge permission.

## Commit gate: let Husky run it once

Before the first gate, activate the installed Node version selected by `.nvmrc` and verify `node --version` / `npm --version`. Put its bin directory first in PATH so npm's Node shebang resolves correctly. A runtime mismatch is not a reason to reinstall dependencies.

Normal commits run these commands in order through `.husky/pre-commit`:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run i18n:validate
npm run db:validate-journal
```

All must pass. Do not bypass hooks or commit with a known failure. Use focused tests while iterating, then let the normal commit hook supply this gate; do not run the identical five-command sequence immediately before and after committing an unchanged tree. A passing hook counts as the unit gate before `gh pr create`, including drafts, when the tested content is unchanged.

## Full gate: build once, then browser tests

For product changes, the default full-gate command after the commit gate is:

```bash
npm run test:e2e
```

The isolated Playwright webServer runs **`npm run build`** (including guarded migration/seed preparation) before starting the server. That successful production-mode build satisfies the build gate; do **not** run a second standalone production build for the same content/environment. Preserve its build output as evidence. If using a different runner or a reused artifact, prove that the required build ran against the tested content and guarded environment; a dev server is not build evidence.

All database-backed build/test processes must bind `DATABASE_URL`, `LOCAL_DATABASE_URL`, and `E2E_DATABASE_URL` to the same dedicated database validated by `scripts/e2e-database-url-guard.mjs`. Use the existing harness, not a bare `npm run build` that could select a developer/production database. Do not print environment values.

- **Standalone product PR:** full gate before marking ready, authorized merge, or a non-draft push. Draft WIP pushes may defer it, explicitly marked pending.
- **Stack:** use the tip-only procedure below, not a full gate per branch.
- **Docs / AGENTS / rules / comments only:** normal commit hooks plus documentation/link/diff checks; build and Playwright are N/A. Changes to runtime configs, test harnesses, executable scripts, dependencies, or migrations are **not** docs-only.
- Auth, invite, connect, session, admin/RBAC, and E2E changes still require updated browser coverage before the final gate. No “CI will catch it.”

## Stacked PRs: one full gate at the tip

1. Freeze the actual linear `headRefName` → `baseRefName` chain and record the root base and every head SHA. Ask which chain is in scope if it forks. A narrow conflict request is not permission to restart an unrelated review campaign.
2. Work root to leaf. Fix a defect on the branch that owns it, add/run focused regressions there, and commit with normal hooks. Before merging a direct parent, record its old tip before fetching and verify `git merge-base --is-ancestor <old-parent-sha> <new-parent-sha>`. If it succeeds and the parent was not otherwise rewritten, merge the updated direct parent into its child, preserving both histories. If it fails, the parent was rebased/force-pushed, or the old boundary is unknown, stop before merging: a merge can retain intentionally dropped commits. Identify the child's verified old parent boundary and propose `git rebase --onto <new-parent-sha> <old-parent-boundary> <child-branch>`; obtain explicit approval for the rewrite and any required force-push before executing it. Do not hide a parent defect in a leaf-only patch or automatically rewrite history.
3. After all fixes propagate, verify every final parent SHA is an ancestor of the final leaf (`git merge-base --is-ancestor <parent-sha> <leaf-sha>`). Check each PR against its direct parent for conflicts. Independently inspect intermediate migration/schema states and branch-specific fixes; tip testing proves the combined tree, not every intermediate tree in isolation.
4. Run **one full validation gate from the final tip** containing all final parent fixes. Earlier passing hook results for that unchanged tip supply the commit gate; run missing checks only. Do not repeat full production builds/browser sweeps on each parent simply because each has a PR.
5. If the tip gate fails, fix the owning branch, run focused regressions, commit normally, merge through all descendants, then rerun the full gate on the new final tip. Do not accept a focused retry as a clean full pass.
6. Publish the verified heads normally in parent-to-child order. Prefer keeping intermediate repairs local until the tip passes. If an intermediate push is explicitly needed for collaboration, disclose **stack validation pending**; do not call it ready. Record the final tip SHA and all covered parent SHAs on the PRs rather than claiming each parent ran the full suite.
7. Re-fetch before declaring readiness. Any changed head/base, conflict resolution, test, dependency, configuration, or runtime input invalidates the affected evidence: propagate first, repeat focused checks as needed, and rerun the full tip gate. A stale parent is not covered by a previous leaf pass. If only an intermediate PR will be merged/deployed separately, treat that PR as the validation tip of the intended delivery chain.

No draft-state changes, PR merges, forced updates, or bypass of required human approvals are implied. Preserve/restore the starting branch without moving its ref unless the maintainer authorized updating that branch.

## Keep caches and installed dependencies

- **Do not remove `.next` or `.next-e2e` routinely** before builds, branch switches, or test retries. Keep compiler caches; rebuild changed content normally. Isolated E2E output belongs in `.next-e2e`, not the developer's `.next`.
- A cache reset needs a reproduced stale/corrupt-artifact problem, the specific affected path, and an explanation of why a normal rebuild/type generation cannot fix it. Prefer targeted regeneration. Obtain approval for destructive removal; never run blanket cleanup as a diagnostic first step.
- **Do not remove `node_modules`.** Do not run `npm ci` in a populated checkout: it deletes the installed tree. Reuse existing dependencies when manifests/lockfile have not changed. When reconciliation is necessary, use the pinned package manager and lockfile with cache-preferred installation (for npm, `npm install --prefer-offline`), review lockfile changes, and keep release-age/security policy unchanged. `npm ci --prefer-offline` is reserved for a fresh disposable checkout without `node_modules`.
- Preserve package-manager caches, Playwright browsers, native/OCR assets, and model caches. Download only missing or changed artifacts. Do not clear caches, reinstall all browsers, or regenerate lockfiles “just in case.”
- Cache preservation is not permission to reuse a stale compiled build or an unknown server. Confirm content/environment provenance, readiness, ownership, and database isolation before reusing a running process. Never terminate an unrelated developer server.

## Safe browser parallelism

- Default to **two workers across spec files**. Keep `fullyParallel: false` so ordered tests and per-file fixtures stay serial. Do not force the whole suite to one worker merely to hide fixture races; `--workers=1` is for diagnosed debugging/resource limits and must be disclosed.
- `scripts/e2e-projects.mjs` defines the parallel project and an ordered chain of single-file exclusive projects for shared DDL/fault injection and the shared Ashed mock. Dependencies prevent those projects from overlapping the parallel phase or each other. The entire default run uses one guarded build/server lifecycle and includes every spec exactly once.
- Use unique fixture identities, tenant-scoped writes/cleanup, and isolated mock state. New shared DDL, fixed-port/global mocks, or cross-tenant/global mutations require isolation or explicit placement in the exclusive chain with a reason. Per-file serial mode alone does not isolate a spec from other workers.
- Focused independent specs: `npm run test:e2e -- --project=parallel e2e/<file>.spec.ts`. A single exclusive spec can use `npm run test:e2e -- --project=<exclusive-project> --no-deps`. Never combine exclusive projects under `--no-deps`; never use it for the full gate.
- Full gate: unfiltered `npm run test:e2e`, with no project, grep, shard, last-failed, or dependency-exclusion filters. Record workers, passed/failed/skipped counts, and retries. Parallel speedups must not weaken assertions, add blanket retries, or silently drop coverage.

## Avoid redundant work; retain honest evidence

- Batch related fixes before a full gate. Reuse successful evidence only for unchanged content, dependencies, configuration, and relevant environment. PR comments/title changes alone do not require a test rerun.
- Do not start a second copy of an in-flight build/test. Check and reuse its process/log; serialize builds sharing generated files or a test database. Independent read-only review can proceed while checks run.
- Use focused failures for diagnosis, then one final full tip pass after corrections. Distinguish a clean full run from focused retries, interruptions, environment-gated skips, and missing CI.
- Record revision/covered stack SHAs, exact commands, worker count, start/end or elapsed time, log locations, and results. Separate build time from browser time when measured; do not add a separate build estimate to a Playwright duration that already includes it.
- Report blockers promptly. Do not spend repeated full-suite runs on a permissions, credentials, isolation, or unrelated-work blocker without first resolving it.
