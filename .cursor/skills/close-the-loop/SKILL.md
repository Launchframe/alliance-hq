---
name: close-the-loop
description: >-
  End-to-end Alliance HQ PR lifecycle after implementation — maintainer
  validation, Real Steel, triage suggestions/nits (blocking / deferred / won't
  do), copy approval per i18n rules, implement fixes, optional re-steel, finalize
  and merge. Use when the user says "close the loop", "close the loop on the
  PR", "address Real Steel suggestions", "address these suggestions and nits",
  "finalize the PR", "finalize and merge", or hands a Real Steel review comment
  / PR URL to drive through merge.
---

# Close the loop

Orchestrate a feature PR from open → Real Steel → feedback triage → fixes →
merge. Sibling skills own sub-steps; this skill owns **sequence, triage buckets,
copy gates, and finalize**.

## Workflow (canonical)

1. Implement, open PR
2. Maintainer validates the PR contents
3. Runs real-steel against the PR
4. Evaluate suggestions & nits. Adjust and approve any temporary copy in accordance with our i18n rules. Determine blocking ("close the loop on the PR"), deferred, or won't do.
5. Implement fixes to suggestions.
6. OPTIONAL: real-steel review of new commits on the PR
7. Finalize and merge

Do not skip step 2 or 4. Agents do not invent merge approval when branch policy requires a human review.

## Related skills and rules

| Concern | Source |
| --- | --- |
| Adversarial review + `real-steel-ready` | [real-steel](../real-steel/SKILL.md) + `~/.cursor/skills/real-steel/SKILL.md` |
| Bot-thread triage / suggested human replies | `~/.cursor/skills/address-pr-feedback/SKILL.md` |
| User-facing English + en-US/pt-BR | [user-facing-copy-review.mdc](../../rules/user-facing-copy-review.mdc), [i18n-all-surfaces.mdc](../../rules/i18n-all-surfaces.mdc) |
| Git / worktree isolation | [agent-git-hygiene.mdc](../../rules/agent-git-hygiene.mdc) |
| Pre-commit gates | `AGENTS.md` → `PRE-COMMIT.md` |

## Step detail

### 1. Implement, open PR

- One concern per branch/worktree (`./scripts/new-worktree.sh`).
- Land code + **approved** locales together; no inline user-facing English.
- Open PR with summary + test plan. Keep draft only if maintainer agreed structure-first before copy.

### 2. Maintainer validates the PR contents

- **Human gate.** Agent waits for explicit validation (approve shape, request changes, or “run real-steel”).
- Do not start Real Steel or close-the-loop triage until the maintainer has validated (or explicitly asked to proceed).

### 3. Runs real-steel against the PR

- Follow [real-steel](../real-steel/SKILL.md): worktree + `move_agent_to_root` once, then pass chain.
- Expect `real-steel-ready` when the chain completes without unresolved Criticals / copy blockers.

### 4. Evaluate suggestions & nits

Read the Real Steel issue comment (and any follow-up threads). For **each** Suggestion and Nit, assign exactly one bucket:

| Bucket | Meaning | Action |
| --- | --- | --- |
| **Blocking** (“close the loop on the PR”) | Must land before merge | Implement in this PR |
| **Deferred** | Valid, not merge-blocking | Note follow-up (issue/TODO); do not block merge |
| **Won't do** | Invalid, out of scope, or intentional | Record rationale; no code change |

**Copy / i18n (hard gate):**

- Any change to user-facing English (or new keys) → present proposals to the maintainer **first**; wait for approval (see copy-review rule).
- Temporary / inaccurate copy called out by Real Steel counts as Blocking until soft/count-accurate wording is **approved**, then implemented in en-US + hand pt-BR together.
- Do **not** run `npm run i18n:translate` or other auto-translate.
- After locale edits: `npm run i18n:validate`.

**Present a triage table** to the maintainer before implementing when buckets are ambiguous or copy is involved. If the maintainer says “address these suggestions” with clear technical items and no new copy, proceed on Blocking items without re-asking for each nit.

### 5. Implement fixes to suggestions

- Work in the PR worktree (not primary clone). Prefer `move_agent_to_root` into that worktree when the environment allows.
- Implement **Blocking** items only (plus maintainer-explicit extras).
- For human Real Steel comments: react (`+1` / `-1` / `eyes`), fix valid items, prepare a concise reply — **post only when the maintainer asks** (or says “post the reply”).
- Bot feedback: follow `address-pr-feedback` (post bot replies; keep human replies suggested unless told to post).
- Run PRE-COMMIT gates (`tsc`, lint, test). Commit (short why-focused message) and push.

### 6. OPTIONAL: real-steel review of new commits on the PR

- Run only when the maintainer asks, or when fixes were large/risky enough that a second pass is warranted.
- Same Real Steel overlay; re-apply / keep `real-steel-ready` per overlay rules.

### 7. Finalize and merge

Finalize means **all** of:

1. Blocking items done; triage for deferred / won't-do recorded (PR reply or chat).
2. Approved copy landed in locales; `i18n:validate` clean.
3. CI green on the tip commit.
4. Human Real Steel reply posted when the maintainer approved the reply text.
5. Merge when policy allows:

```bash
gh pr checks <n> --watch
gh pr merge <n> --squash --delete-branch
```

If merge is **BLOCKED** (e.g. `REVIEW_REQUIRED`), do not use `--admin` unless the maintainer explicitly asks. Report the blocker and stop.

Auto-merge (`gh pr merge --auto`) only when the repo supports it; otherwise watch checks then merge, or hand off for human approve + merge.

## Invocation shortcuts

| User says | Start at |
| --- | --- |
| “close the loop on the PR” + PR URL / Real Steel comment | Step 4 (assume 1–3 done) |
| “address these suggestions and nits” | Step 4 → 5; hold copy until approved |
| “post the reply and finalize” | Post approved reply → step 7 |
| “/real-steel …” | Step 3 only (handoff back here for 4–7) |

## Output contract (after a close-the-loop run)

1. PR number + URL
2. Triage table: Blocking / Deferred / Won't do (each with one-line rationale)
3. Copy: proposals awaiting approval, or keys changed after approval
4. Commits pushed + CI status
5. Reply posted or suggested (unposted)
6. Merge result, or exact blocker (e.g. required review)
