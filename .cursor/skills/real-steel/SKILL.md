---
name: real-steel
description: Alliance HQ overlay for Real Steel — applies the global multi-model PR review workflow plus repo-specific completion steps (real-steel-ready label, maintainer-approved checkout policy). Use when the user says /real-steel in this repo.
disable-model-invocation: true
---

# Real Steel — Alliance HQ overlay

This repo extends the global Real Steel skill at `~/.cursor/skills/real-steel/SKILL.md`. Follow its review workflow (Task chain, run log, PR comments, per-pass commits), but follow this repo's [checkout policy](../../rules/agent-git-hygiene.mdc) instead of automatic worktree instructions: **do not use worktrees unless explicitly requested by the maintainer for the current task**.

**This file adds Alliance HQ completion requirements and orchestrator isolation rules.**

## Primary clone by default — no automatic worktrees

A request for Real Steel is not a request for a worktree. Use the PR's topic branch in the primary clone and run writing passes sequentially. Check that the checkout is clean and no other writer owns it before switching branches; otherwise coordinate or wait.

| Do | Don't |
| --- | --- |
| Use the primary clone on the PR branch by default | Create or reuse a linked worktree merely because a review is multi-pass |
| Serialize writing passes and builds in that checkout | Run concurrent writers against the same working directory |
| Obtain an explicit maintainer request before using an additional worktree | Treat global skill defaults, disk availability, or convenience as permission |

Only when the maintainer explicitly requests a worktree may the orchestrator create or use it and call `move_agent_to_root` once into that approved path. Keep the task's passes in that same checkout, preserve its local environment, and obtain approval before removing the directory.

## PR completion label (`real-steel-ready`)

After **every** completed Real Steel run in this repo — **one pass or many** — the orchestrator must apply the GitHub label `real-steel-ready` to the PR **unless** blockers remain that require **maintainer intervention**.

| Apply label | Withhold label (maintainer must act) |
| --- | --- |
| Chain finished (1 pass, multi-pass, post-mortem included) | Unresolved **Critical** findings agents could not fix in-chain |
| Only Suggestion/Nit items left open | Merge conflicts with base that could not be resolved |
| Critical issues were found **and fixed** in-chain | In-scope CI still red after passes; cannot fix without weakening gates |
| Clean pass (no code changes) | — |
| Copy fixes landed in-chain | Apply label when disclosed on the PR per async copy exception in [user-facing-copy-review.mdc](../rules/user-facing-copy-review.mdc) — not a withhold reason |
| Open items are manual QA or follow-ups, not code blockers | Explicit product/security decisions only the maintainer can make |

**Not optional for single-pass runs.** `/real-steel composer` gets the same label step as `/real-steel chat sonnet composer`.

```bash
gh pr edit <number> --add-label real-steel-ready
# If that fails (e.g. Projects classic deprecation), use:
gh api repos/Launchframe/alliance-hq/issues/<number>/labels -f "labels[]=real-steel-ready"
```

If the label does not exist, create it first or tell the maintainer. Record in the local run log (`.cursor/real-steel/pr-<number>-<YYYYMMDD>.md`) whether the label was applied or withheld and why. Mention label status in the final summary.

## Copy in applied fixes

When a pass fixes a finding that needs new or changed user-facing strings, **apply the fix** — do not defer for interactive copy approval. Follow the **asynchronous review agents** exception in [user-facing-copy-review.mdc](../rules/user-facing-copy-review.mdc):

1. Land `en-US` + hand `pt-BR` (and Discord localizations if applicable) in the fix commit.
2. In that pass’s PR comment, add `## Copy (pending maintainer review)` listing every key, English value, and surface.
3. Run `npm run i18n:validate` before commit.

Include the copy-disclosure requirement in each pass Task prompt when the repo has `user-facing-copy-review.mdc`.

## Orchestrator checklist (Alliance HQ)

After the global skill's pass loop completes:

1. Apply or withhold `real-steel-ready` per the table above.
2. Include label status in the user-facing summary alongside remaining risks, run log path, CI status, and Task vs orchestrator-inline execution notes.

## Auth boundary review (Real Steel)

When the PR touches `src/lib/rbac/**`, `src/lib/session/**`, `src/lib/auth/**`, `/api/auth/**`, `/api/admin/**`, or e2e auth/RBAC specs, **at least one pass** must follow [`.cursor/rules/auth-boundary-review.mdc`](../../rules/auth-boundary-review.mdc):

| Pass | Mode | Required work |
| --- | --- | --- |
| **Permission primitive** | Auth architecture | § A — `sessionHasPermission*`; no `return true` on `hqUserId` null; grep red flags |
| **Privilege e2e** | Auth architecture | § C — negative bootstrap → admin (or extend `e2e/rbac-anonymous-session.spec.ts`); maintainer positive control |
| **Route compliance** | Route compliance | Handler calls correct `require*`; tenant filter by alliance |

**Security-review / Bugbot-style passes** on auth PRs: use **Auth architecture** `Custom Instructions` from § F of the rule. Route-compliance-only review is insufficient for `real-steel-ready` on those PRs.

Include in each auth-touching Task prompt:

```text
Read .cursor/rules/auth-boundary-review.mdc. Run permission primitive pass (§ A) and confirm privilege e2e (§ C) for any new admin or high-privilege surface in the diff.
```

## When to stop early

Follow the global skill. Additionally for this repo:

- **Clean pass or out-of-scope CI red** — still apply `real-steel-ready` when the chain ends if no unresolved Critical issues in scope.
- **Merge conflicts with base** — do **not** apply `real-steel-ready` until resolved or the maintainer takes over.

## After Real Steel

To triage suggestions/nits, land copy-approved fixes, and merge, use [close-the-loop](../close-the-loop/SKILL.md).

Continue close-the-loop on the PR branch in the same primary checkout by default. If the maintainer explicitly requested a worktree for this task, reuse that approved checkout only within the request's scope; do not create another automatically. Preserve WIP and local data, and obtain approval before removing any worktree.
