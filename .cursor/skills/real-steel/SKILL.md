---
name: real-steel
description: Alliance HQ overlay for Real Steel — applies the global multi-model PR review workflow plus repo-specific completion steps (real-steel-ready label, worktree isolation). Use when the user says /real-steel in this repo.
disable-model-invocation: true
---

# Real Steel — Alliance HQ overlay

This repo extends the global Real Steel skill at `~/.cursor/skills/real-steel/SKILL.md`. Follow the global skill for the full workflow (Task chain, run log, PR comments, per-pass commits, worktree isolation per [`.cursor/rules/agent-git-hygiene.mdc`](../rules/agent-git-hygiene.mdc)).

**This file adds Alliance HQ completion requirements and orchestrator isolation rules.**

## Worktree isolation — move once into the PR worktree

Maintainer preference (updated 2026-07-12): **do** call `move_agent_to_root` **once** into the Real Steel worktree at the start of the run.

| Do | Don't |
| --- | --- |
| `./scripts/new-worktree.sh` (or refresh) for the PR branch | Leave the chat rooted in primary / another worktree while editing the PR tree |
| `move_agent_to_root` **once** → PR worktree (accept one Smart Mode approval if needed) | Skip the move and `Edit`/`Write` absolute paths under a sibling worktree (causes **per-file** approval spam) |
| Launch each pass `Task` with that worktree as cwd | Parent `git checkout` of the PR branch in the primary clone |

**Why:** Cursor auto-approves edits **inside** the current workspace. Edits **outside** it (sibling `../alliance-hq-*` paths) require approval on every file. Skipping the move avoided one MCP prompt but made ordinary coding unusable.

Parallel agents stay isolated via **separate worktree dirs + branches**. The move is so *this* chat’s write surface matches the PR worktree.

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

When the PR touches `src/lib/rbac/**`, `src/lib/session/**`, `src/lib/auth/**`, `/api/auth/**`, `/api/admin/**`, or e2e auth/RBAC specs, **at least one pass** must follow [`.cursor/rules/auth-boundary-review.mdc`](../rules/auth-boundary-review.mdc):

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

If the maintainer will close the loop in the same session, **keep** the Real Steel worktree (do not remove it yet). Close-the-loop prefers that worktree for fixes; otherwise it refreshes via `./scripts/new-worktree.sh`.
