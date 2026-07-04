---
name: real-steel
description: Alliance HQ overlay for Real Steel — applies the global multi-model PR review workflow plus repo-specific completion steps (real-steel-ready label, worktree isolation). Use when the user says /real-steel in this repo.
disable-model-invocation: true
---

# Real Steel — Alliance HQ overlay

This repo extends the global Real Steel skill at `~/.cursor/skills/real-steel/SKILL.md`. Follow the global skill for the full workflow (Task chain, run log, PR comments, per-pass commits, worktree isolation per [`.cursor/rules/agent-git-hygiene.mdc`](../rules/agent-git-hygiene.mdc)).

**This file adds Alliance HQ completion requirements only.**

## PR completion label (`real-steel-ready`)

After **every** completed Real Steel run in this repo — **one pass or many** — the orchestrator must apply the GitHub label `real-steel-ready` to the PR **unless** blockers remain that require **maintainer intervention**.

| Apply label | Withhold label (maintainer must act) |
| --- | --- |
| Chain finished (1 pass, multi-pass, post-mortem included) | Unresolved **Critical** findings agents could not fix in-chain |
| Only Suggestion/Nit items left open | Merge conflicts with base that could not be resolved |
| Critical issues were found **and fixed** in-chain | In-scope CI still red after passes; cannot fix without weakening gates |
| Clean pass (no code changes) | i18n / user-facing copy blocked on maintainer approval (per [`.cursor/rules/user-facing-copy-review.mdc`](../rules/user-facing-copy-review.mdc)) |
| Open items are manual QA or follow-ups, not code blockers | Explicit product/security decisions only the maintainer can make |

**Not optional for single-pass runs.** `/real-steel composer` gets the same label step as `/real-steel chat sonnet composer`.

```bash
gh pr edit <number> --add-label real-steel-ready
# If that fails (e.g. Projects classic deprecation), use:
gh api repos/Launchframe/alliance-hq/issues/<number>/labels -f "labels[]=real-steel-ready"
```

If the label does not exist, create it first or tell the maintainer. Record in the local run log (`.cursor/real-steel/pr-<number>-<YYYYMMDD>.md`) whether the label was applied or withheld and why. Mention label status in the final summary.

## Orchestrator checklist (Alliance HQ)

After the global skill's pass loop completes:

1. Apply or withhold `real-steel-ready` per the table above.
2. Include label status in the user-facing summary alongside remaining risks, run log path, CI status, and Task vs orchestrator-inline execution notes.

## When to stop early

Follow the global skill. Additionally for this repo:

- **Clean pass or out-of-scope CI red** — still apply `real-steel-ready` when the chain ends if no unresolved Critical issues in scope.
- **Merge conflicts with base** — do **not** apply `real-steel-ready` until resolved or the maintainer takes over.
