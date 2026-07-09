# Branch wrap-up working doc

**Owner:** andrew  
**Repo:** alliance-hq (`/Users/andrew/workspace/alliance-hq`)  
**Baseline:** `origin/main` @ `fcd76d4` (2026-07-09)  
**Status:** 129 unmerged local branches · 21 active worktrees · 0 done

---

## Maintainer intent (prompt for agents)

Use this doc as the single source of truth for clearing Alliance HQ branch debt. **andrew** wants every unfinished local branch resolved in one shot — no long-lived WIP branches left behind.

> **Agent prompt — paste into a new session:**
>
> You are helping **andrew** finish Alliance HQ branch cleanup. Read `docs/plans/andrew-branch-wrapup.md` in `/Users/andrew/workspace/alliance-hq`.
>
> Goal: **one-shot wrap up every unfinished branch** — each row in the matrix must end in exactly one terminal state. Work from the primary clone; use existing worktrees when listed. Follow `.cursor/rules/agent-git-hygiene.mdc`.
>
> For **each branch**, in order:
> 1. **Triage** — compare `main...branch`. Check for an open/merged PR (`gh pr list --head <branch>`). Flag squash-already-on-main duplicates (`git diff main...branch` empty or trivial).
> 2. **Decide disposition** (record in the matrix):
>    - `merge` — ship via PR (rebase on main, CI green, merge). Prefer consolidating overlapping branches first.
>    - `cherry-pick` — salvage a small subset onto a fresh branch; abandon the rest.
>    - `consolidate` — fold into a canonical sibling branch (e.g. commander-claim phases → one branch).
>    - `on-main` — content already landed; soft-delete local branch + worktree only.
>    - `abandon` — obsolete/superseded; delete local (+ remote if no PR) with a one-line reason.
>    - `defer` — only if blocked on andrew; document the blocker in Notes.
> 3. **Execute** — complete the disposition end-to-end (PR, merge, or delete). Remove worktree when done: `git worktree remove --force <path> && git worktree prune`. Soft-delete merged locals: `git branch -d <branch>`.
> 4. **Update this doc** — check Done `[x]`, fill Disposition + Notes, decrement the status counts at the top.
>
> **Priorities:** active worktrees first · small fix/* and fix/observability branches · consolidate commander-claim phase stack · collapse duplicate roster-link locals · batch video-pipeline fixes where safe.
>
> **Do not:** force-push main · delete remote feature branches that have open PRs without andrew's OK · read `.env.local` contents.
>
> When a feature group is fully done, add a one-line summary under **Completed groups** below.

---

## How to use this doc

| Column | Meaning |
| --- | --- |
| **Done** | Check when branch is fully resolved (merged, abandoned, or confirmed on-main). |
| **Branch** | Local branch name. |
| **Worktree** | Sibling directory under `~/workspace/` if checked out in a worktree. |
| **Unmerged changes** | Tip commit subject (what's still off main). |
| **Diff vs main** | `git diff --shortstat main...branch` at last audit. |
| **Disposition** | Terminal action taken (see agent prompt). |
| **Notes** | PR link, consolidation target, abandon reason, blocker. |

### Disposition legend

| Value | Meaning |
| --- | --- |
| `merge` | Opened/merged PR with this branch's changes. |
| `cherry-pick` | Subset salvaged elsewhere; branch deleted. |
| `consolidate` | Folded into another branch (note which). |
| `on-main` | Already on main (squash); local only deleted. |
| `abandon` | Intentionally discarded. |
| `defer` | Blocked — waiting on andrew. |

### Already cleaned up (2026-07-09)

Soft-deleted after confirming merged to `main`:

| Branch | Notes |
| --- | --- |
| `feat/claim-invite-member-no-passphrase` | worktree removed (had local edits) |
| `feat/discord-native-setup-help` | worktree removed (had local edits) |
| `feat/video-queue-handoff` | worktree removed (had local edits) |
| `fix/discord-link-commander-wrong-server` | local only |
| `fix/unblock-invites-server-gate` | local only |
| `test/stale-session-bootstrap` | local only |

### Likely stale locals (verify first)

These probably landed on `main` via squash merge but the local tip diverged:

- `fix/release-notes-edge-config-size`
- `roster-link-email-ui` / `roster-link-request-core` (duplicate of `feat/roster-link-*`)
- `video-review-preview-tweaks` (duplicate of `feat/video-review-preview-tweaks`)

### Active worktrees (21)

| Worktree dir | Branch |
| --- | --- |
| `alliance-hq-admin-server` | `feat/admin-alliance-server-number` |
| `alliance-hq-alliance-setup-request` | `feat/alliance-setup-request` |
| `alliance-hq-alliance-switch-nav-stale` | `fix/alliance-switch-nav-stale` |
| `alliance-hq-battle-plan-phase-1` | `feat/battle-plan-phase-1` |
| `alliance-hq-commander-claim-phase-6-queue` | `feat/commander-claim-phase-6-queue` |
| `alliance-hq-commander-power-stats` | `feat/commander-power-stats` |
| `alliance-hq-dashboard` | `feat/alliance-dashboard-analytics` |
| `alliance-hq-discord-funnels` | `feat/discord-link-funnels` |
| `alliance-hq-discord-link-join-code` | `feat/discord-link-join-code-inline` |
| `alliance-hq-follow-me-scroll-up-frame` | `fix/follow-me-scroll-up-frame` |
| `alliance-hq-global-loading-indicators` | `feat/global-loading-indicators` |
| `alliance-hq-hide-my-nav-without-member-link` | `fix/hide-my-nav-without-member-link` |
| `alliance-hq-invite-wizard` | `feat/invite-wizard` |
| `alliance-hq-loading-local-spinners` | `feat/loading-local-spinners` |
| `alliance-hq-loading-remaining` | `feat/loading-remaining` |
| `alliance-hq-my-thp` | `feat/my-thp` |
| `alliance-hq-price-is-right-economy-template` | `feat/price-is-right-economy-template` |
| `alliance-hq-self-service-onboarding` | `feat/officer-cold-start` |
| `alliance-hq-vr-weekly` | `feat/vr-weekly-pass` |
| `alliance-hq-web-vr-tracker` | `feat/discord-link-uid-only` |
| `alliance-hq-welcome-invite-urls` | `feat/welcome-invite-urls` |

### Completed groups

_(none yet)_

---

## Branch matrix

_Regenerate diff stats after large main moves:_

```bash
cd /Users/andrew/workspace/alliance-hq
git fetch origin main
# then re-run the audit script or update rows manually
```

### Admin

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/admin-alliance-server-number` | `alliance-hq-admin-server` | feat(onboard): owner onboarding unblockers for member link | 20 files changed, 1504 insertions(+), 40 deletions(-) | | |
| [ ] | `feat/admin-user-linked-commanders` | — | feat(admin): show linked commanders with UID on HQ user detail. | 5 files changed, 311 insertions(+), 2 deletions(-) | | |
| [ ] | `feat/admin-user-sign-in-methods` | — | fix(auth): block email codes for OAuth-only accounts with clear guidance | 20 files changed, 731 insertions(+), 16 deletions(-) | | |
| [ ] | `fix/admin-video-job-uploader` | — | feat(feedback): hide FAB on video review and expose actions in profile menu | 35 files changed, 728 insertions(+), 159 deletions(-) | | |

### Alliance / Dashboard

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/alliance-dashboard-analytics` | `alliance-hq-dashboard` | feat(dashboard): native alliance analytics hub with hybrid Ashed shell | 48 files changed, 3453 insertions(+), 14 deletions(-) | | |
| [ ] | `feat/alliance-setup-request` | `alliance-hq-alliance-setup-request` | Add alliance setup request flow for Discord install wizard. | 60 files changed, 3087 insertions(+), 370 deletions(-) | | |
| [ ] | `fix/alliance-switch-nav-stale` | `alliance-hq-alliance-switch-nav-stale` | Fix stale sidebar nav when switching to an Ashed alliance. | 4 files changed, 91 insertions(+), 1 deletion(-) | | |

### Ashed integration

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `fix/ashed-connect-stub-collision` | — | real-steel(composer): add stub collision test coverage | 8 files changed, 227 insertions(+), 11 deletions(-) | | |
| [ ] | `fix/ashed-credential-persist-on-alliance-switch` | — | fix(alliance): preserve personal Ashed credential across alliance switch | 2 files changed, 24 insertions(+), 33 deletions(-) | | |
| [ ] | `fix/ashed-sync-adopt-native-shell` | — | Adopt native alliance shells on Ashed sync instead of creating duplicates. | 6 files changed, 210 insertions(+), 3 deletions(-) | | |
| [ ] | `fix/link-ashed-member-credentials` | — | real-steel(Composer): add authorize route tests for collaborator credential linking | 2 files changed, 188 insertions(+), 14 deletions(-) | | |
| [ ] | `fix/members-roster-lazy-ashed-sync` | — | Skip eager Ashed roster sync on every /members load. | 7 files changed, 148 insertions(+), 10 deletions(-) | | |

### Auth / Identity

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/oauth-linking-e2e-coverage` | — | test(e2e): cover OAuth split badge, linking, and shim | 4 files changed, 534 insertions(+) | | |
| [ ] | `feat/oauth-provider-id-linking` | — | fix(e2e): bootstrap alliance access for settings oauth-linking tests | 39 files changed, 1446 insertions(+), 166 deletions(-) | | |
| [ ] | `fix/device-link-ashed-identity` | — | fix(device-link): copy ashedUserId when pairing mobile sessions | 2 files changed, 109 insertions(+) | | |
| [ ] | `fix/oauth-only-email-sign-in-errors` | — | fix(auth): block email codes for OAuth-only accounts with clear guidance | 17 files changed, 568 insertions(+), 15 deletions(-) | | |
| [ ] | `fix/postgres-auth-recovery` | — | fix(db): recover from stale Neon credentials on warm serverless instances | 11 files changed, 195 insertions(+), 31 deletions(-) | | |

### Backup / WIP

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `backup/native-ocr-pre-rebase-1782554297` | — | chore(drizzle): renumber OCR eval migration to 0062 after main sync | 51 files changed, 2412 insertions(+), 259 deletions(-) | | |

### Battle plan

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/battle-plan-phase-1` | `alliance-hq-battle-plan-phase-1` | Add battle plan scheduling core (phase 1). | 28 files changed, 2266 insertions(+), 1 deletion(-) | | |

### Bug fixes

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `fix/follow-me-scroll-up-frame` | `alliance-hq-follow-me-scroll-up-frame` | feat(video): Interpolate follow-me seek between roster timestamps | 5 files changed, 199 insertions(+), 201 deletions(-) | | |
| [ ] | `fix/join-code-session-hygiene` | — | test(e2e): join-code session hygiene after sign-out | 12 files changed, 579 insertions(+), 45 deletions(-) | | |
| [ ] | `fix/members-roster-polish` | — | Polish lazy roster sync after PR #188. | 5 files changed, 20 insertions(+), 6 deletions(-) | | |
| [ ] | `fix/officer-help-reminders-nav` | — | fix: officer help unlink, reminder badge, filters, setup guide | 13 files changed, 240 insertions(+), 45 deletions(-) | | |
| [ ] | `fix/reprocess-route-sharp-tracing` | — | Trace sharp and tesseract deps for video reprocess route. | 3 files changed, 39 insertions(+), 23 deletions(-) | | |
| [ ] | `fix/sharp-global-libvips-tracing` | — | Fix sharp libvips failures on all Vercel serverless routes. | 9 files changed, 124 insertions(+), 83 deletions(-) | | |
| [ ] | `fix/tesseract-serial-ocr` | — | Serialize native Tesseract OCR to fix empty roster parses on Vercel. | 3 files changed, 84 insertions(+), 33 deletions(-) | | |
| [ ] | `fix/vs-score-first-frame-missing` | — | fix(video): force opening frame capture at 100ms | 2 files changed, 126 insertions(+), 34 deletions(-) | | |
| [ ] | `fix/week-schedule-strip-tuesday-week` | — | real-steel(Claude Sonnet): register 0039 migration in drizzle journal | 12 files changed, 334 insertions(+), 39 deletions(-) | | |

### Commander / Member linking

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/commander-claim-phase-1-copy` | — | fix(e2e): update member-link submit button selector to Link my Commander | 45 files changed, 2897 insertions(+), 151 deletions(-) | | |
| [ ] | `feat/commander-claim-phase-2-invites` | — | fix(member-link): persist claim conflicts to officer review queue | 63 files changed, 4645 insertions(+), 182 deletions(-) | | |
| [ ] | `feat/commander-claim-phase-3-unlink` | — | Merge phase-1 (commander claim phase 2 + conflict persistence) into phase-3 unlink | 68 files changed, 5526 insertions(+), 202 deletions(-) | | |
| [ ] | `feat/commander-claim-phase-4-uid-confirm` | — | fix(e2e): match onboarding submit button copy 'Link my Commander' in UID-only specs | 69 files changed, 5947 insertions(+), 300 deletions(-) | | |
| [ ] | `feat/commander-claim-phase-6-queue` | `alliance-hq-commander-claim-phase-6-queue` | real-steel(ChatGPT): harden claim conflict dedup | 47 files changed, 4944 insertions(+), 247 deletions(-) | | |
| [ ] | `feat/commander-identity` | — | chore: sync package-lock version to 0.13.0 | 20 files changed, 1148 insertions(+), 54 deletions(-) | | |
| [ ] | `feat/commander-identity-phase2` | — | real-steel(Sonnet): guard commander sync on close when no open tenure exists | 8 files changed, 405 insertions(+), 38 deletions(-) | | |
| [ ] | `feat/commander-nullable-uid` | — | real-steel(Composer): fix stale owner onboarding e2e for required game server | 33 files changed, 2076 insertions(+), 300 deletions(-) | | |
| [ ] | `feat/commander-power-stats` | `alliance-hq-commander-power-stats` | feat(members): consolidate Power Level and THP on commanders | 40 files changed, 860 insertions(+), 373 deletions(-) | | |
| [ ] | `feat/commanders-index` | — | fix(e2e): commanders index spec session and cookie headers | 28 files changed, 1977 insertions(+), 46 deletions(-) | | |
| [ ] | `feat/discord-commander-link-web-form` | — | feat(discord): route commander player ID through secure web form | 20 files changed, 836 insertions(+), 137 deletions(-) | | |
| [ ] | `feat/discord-link-commander-auth-flow` | — | feat(discord): gate link-commander web flow on auth, Discord OAuth, and join code | 13 files changed, 494 insertions(+), 108 deletions(-) | | |
| [ ] | `feat/member-link-claim-conflict-dedup` | — | (real-steel) Suggestion addresses:  - Show claimConflictReason in the officer review detail (name collision vs target mismatch vs server mismatch).  - Extend subtitle copy to mention claim conflicts alongside roster-miss.  - Broaden unit test coverage beyond target_mismatch (other conflict reasons follow the same surfaceClaimConflict path). | 13 files changed, 547 insertions(+), 64 deletions(-) | | |
| [ ] | `feat/roster-link-email-ui` | — | Merge main into feat/roster-link-email-ui and address PR #64 review. | 17 files changed, 899 insertions(+), 146 deletions(-) | | |
| [ ] | `feat/roster-link-request-core` | — | Merge remote-tracking branch 'origin/main' into feat/roster-link-request-core | 12 files changed, 1060 insertions(+), 9 deletions(-) | | |
| [ ] | `feat/web-member-link-onboarding` | — | feat: optional Ashed for privileged roles, admin users search, onboarding audit | 95 files changed, 5649 insertions(+), 512 deletions(-) | | |
| [ ] | `fix/hide-my-nav-without-member-link` | `alliance-hq-hide-my-nav-without-member-link` | Hide My THP/VR nav unless user has alliance member link. | 6 files changed, 78 insertions(+), 4 deletions(-) | | |
| [ ] | `fix/member-link-help-post-link-redirect` | — | fix(404): treat HQ browser session as signed-in | 8 files changed, 65 insertions(+), 26 deletions(-) | | |
| [ ] | `roster-link-email-ui` | — | Merge branch 'feat/roster-link-request-core' into feat/roster-link-email-ui | 19 files changed, 1644 insertions(+), 10 deletions(-) | | |
| [ ] | `roster-link-request-core` | — | Merge branch 'feat/roster-link-request-core' into feat/roster-link-email-ui | 19 files changed, 1644 insertions(+), 10 deletions(-) | | |

### Data management RBAC

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feature/data-management-rbac` | — | docs: clarify native Data Management RBAC; fix props spacing | 23 files changed, 1511 insertions(+), 3 deletions(-) | | |

### Discord

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/discord-command-rename` | — | fix(discord): make /link authorize session-aware to avoid OAuthAccountNotLinked | 23 files changed, 602 insertions(+), 501 deletions(-) | | |
| [ ] | `feat/discord-link-funnels` | `alliance-hq-discord-funnels` | feat(discord): clarify account section is the Discord bot connection | 22 files changed, 1036 insertions(+), 36 deletions(-) | | |
| [ ] | `feat/discord-link-join-code-inline` | `alliance-hq-discord-link-join-code` | chore: drop accidental commit message temp file | 8 files changed, 285 insertions(+), 14 deletions(-) | | |
| [ ] | `feat/discord-link-name-uid` | — | Address real-steel open risks: native Discord owner claim, dead Ashed-gate cleanup, UID privacy guardrails | 50 files changed, 1824 insertions(+), 521 deletions(-) | | |
| [ ] | `feat/discord-link-uid-only` | `alliance-hq-web-vr-tracker` | fix(discord): keep slash command descriptions within Discord 100-char limit | 13 files changed, 475 insertions(+), 110 deletions(-) | | |
| [ ] | `feat/discord-officer-invites` | — | Implement Discord officer invite flow. | 14 files changed, 734 insertions(+), 29 deletions(-) | | |
| [ ] | `feat/discord-server-self-service` | — | feat(discord): self-service second-server bot setup for owners, officers, maintainers | 15 files changed, 508 insertions(+), 19 deletions(-) | | |
| [ ] | `feat/discord-setup-identity-refactor` | — | feat(discord): split /link from /link-commander and fix setup catch-22 | 20 files changed, 743 insertions(+), 230 deletions(-) | | |
| [ ] | `feat/discord-train-bot` | — | fix(discord): break /link catch-22 when legacy name option is present | 36 files changed, 1936 insertions(+), 16 deletions(-) | | |
| [ ] | `feat/invite-discord-primary-option-b` | — | feat(invite): Discord-first sign-in for invite flows (Option B) | 11 files changed, 238 insertions(+), 41 deletions(-) | | |
| [ ] | `feat/preapproved-discord-link` | — | refactor: share claim-target helpers between web and Discord pre-approve | 12 files changed, 754 insertions(+), 98 deletions(-) | | |
| [ ] | `fix/discord-bot-locale-urls` | — | Prefix Discord bot HQ links with the user's /language locale. | 12 files changed, 139 insertions(+), 46 deletions(-) | | |
| [ ] | `fix/discord-thp-button-tolocalestring` | — | Fix Discord THP confirm crash on stale VR pending state. | 5 files changed, 168 insertions(+), 11 deletions(-) | | |

### Discord / Multi-tenant

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `amcmillion/discord-multi-tenant-hardening` | — | Cap /takedown-teams teams:{max5} | 32 files changed, 1099 insertions(+), 128 deletions(-) | | |

### Docs

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `docs/copy-review-planning-flow` | — | docs(rules): plan-first copy review, implement locales together | 3 files changed, 51 insertions(+), 22 deletions(-) | | |

### Features (misc)

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/maintainer-alliance-switch` | — | fix(video): only gate queue approval on Ashed when the OCR engine needs it | 21 files changed, 616 insertions(+), 163 deletions(-) | | |
| [ ] | `feat/members-linking-metrics-attention-badges` | — | Add members page HQ link metrics and officer attention badges. | 11 files changed, 368 insertions(+), 8 deletions(-) | | |
| [ ] | `feat/r5-getting-started` | — | fix(guides): use role title in Discord bot step breadcrumbs | 43 files changed, 1698 insertions(+), 364 deletions(-) | | |
| [ ] | `feat/war-leader-support` | — | Redesign Profession page with unified nav and officer tools. | 41 files changed, 4824 insertions(+), 9 deletions(-) | | |

### Game season model

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/game-server-season-model` | — | feat(game-season): normalize Alliance → Server → Season graph | 52 files changed, 3457 insertions(+), 77 deletions(-) | | |
| [ ] | `fix/cpt-hedge-season-sync-and-override-ux` | — | fix(game-season): repair cpt-hedge sync and season override UX | 8 files changed, 184 insertions(+), 15 deletions(-) | | |

### HQ shell / Auth

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/hq-account-merge` | — | test(e2e): scope account settings selectors to email vs merge cards | 18 files changed, 2049 insertions(+), 17 deletions(-) | | |
| [ ] | `feat/hq-auth-invite-provisioning` | — | Prepare production domain frontline.gay for Vercel and Resend. | 92 files changed, 5875 insertions(+), 426 deletions(-) | | |
| [ ] | `feat/hq-email-change` | — | fix(auth): bridge browser session after HQ email change confirm | 21 files changed, 1277 insertions(+), 22 deletions(-) | | |
| [ ] | `feat/hq-slice-a2-connect-return` | — | real-steel(composer): preserve sessionStorage return-path fallback | 12 files changed, 247 insertions(+), 28 deletions(-) | | |
| [ ] | `feat/hq-slice-c-settings-consolidation` | — | fix(e2e): set maintainer alliance context via API in discord test | 22 files changed, 354 insertions(+), 226 deletions(-) | | |
| [ ] | `feat/hq-slice-d-nav-trim` | — | fix(vr): gate viral-resistance page for members:write | 12 files changed, 116 insertions(+), 25 deletions(-) | | |
| [ ] | `feat/hq-slice-e-roster-merge` | — | fix(e2e): disambiguate roster member link on unified /members | 19 files changed, 1764 insertions(+), 858 deletions(-) | | |
| [ ] | `feat/hq-slice-f-mobile-violations` | — | fix(members): sync discipline to DB and fix mobile profile overflow | 10 files changed, 563 insertions(+), 56 deletions(-) | | |
| [ ] | `feat/hq-slice-g-sign-in-quick-access` | — | fix(e2e): skip redeem JSON after navigation | 25 files changed, 1129 insertions(+), 307 deletions(-) | | |
| [ ] | `fix/hq-only-relogin` | — | real-steel(Composer): test conflicting Ashed credential RBAC guard | 12 files changed, 249 insertions(+), 47 deletions(-) | | |

### Inbox / Reminders

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/inbox-eur-reminders` | — | feat(inbox): ops inbox and event upload reminder system | 40 files changed, 2739 insertions(+), 9 deletions(-) | | |

### Invites / Onboarding

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/invite-server-gate` | — | R2 cors docs; fix e2e tests | 39 files changed, 1421 insertions(+), 83 deletions(-) | | |
| [ ] | `feat/invite-wizard` | `alliance-hq-invite-wizard` | Replace team invite panels with a guided 3-step officer wizard. | 112 files changed, 7763 insertions(+), 1389 deletions(-) | | |
| [ ] | `feat/officer-cold-start` | `alliance-hq-self-service-onboarding` | Allow officer invites to cold-start empty native rosters. | 97 files changed, 6061 insertions(+), 437 deletions(-) | | |
| [ ] | `feat/self-service-member-onboarding` | — | Audit-log onboarding review decisions with resolving officer. | 95 files changed, 6024 insertions(+), 428 deletions(-) | | |
| [ ] | `feat/unblock-invites-server-gate` | — | feat: allow officer/member invites without linked game server | 19 files changed, 105 insertions(+), 216 deletions(-) | | |
| [ ] | `feat/welcome-invite-urls` | `alliance-hq-welcome-invite-urls` | Add welcome URLs and share messages to invite API responses. | 119 files changed, 8105 insertions(+), 1391 deletions(-) | | |
| [ ] | `fix/onboarding-review-select-light-mode` | — | fix(ui): theme-aware roster match select on onboarding review | 1 file changed, 21 insertions(+), 21 deletions(-) | | |
| [ ] | `test/native-alliance-owner-onboarding-e2e` | — | real-steel(Composer): fix native owner onboarding e2e officer-block assertion | 4 files changed, 271 insertions(+), 16 deletions(-) | | |

### Multi-tenancy / Profiles

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `amcmillion/multi-tenancy` | — | Add profile avatar storage, resolution, and UI display. | 38 files changed, 1892 insertions(+), 232 deletions(-) | | |

### Observability / Infra

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/vercel-observability` | — | feat(observability): add Speed Insights and DB health analytics events | 7 files changed, 114 insertions(+), 2 deletions(-) | | |
| [ ] | `fix/observability-rs-pr155` | — | fix(db): probe LISTEN liveness and align admin-alerts SSE reconnect | 9 files changed, 302 insertions(+), 30 deletions(-) | | |
| [ ] | `fix/release-notes-edge-config-size` | — | fix(release): compact Edge Config payload to stay under 64 KiB limit. | 5 files changed, 154 insertions(+), 18 deletions(-) | | |
| [ ] | `fix/tesseract-vercel-bundle` | — | Fix in-house OCR on Vercel by bundling tesseract.js worker files. | 3 files changed, 32 insertions(+), 22 deletions(-) | | |

### Price Is Right

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/price-is-freight-template-label` | — | feat(trains): rename Price Is Right template to The Price Is Freight | 3 files changed, 20 insertions(+), 6 deletions(-) | | |
| [ ] | `feat/price-is-right-economy-template` | `alliance-hq-price-is-right-economy-template` | feat(trains): add The Price Is Right economy template | 23 files changed, 632 insertions(+), 1 deletion(-) | | |
| [ ] | `feat/price-is-right-ticket-weighting` | — | Add Price Is Freight exponential raffle ticket weighting. | 22 files changed, 1886 insertions(+), 41 deletions(-) | | |

### THP

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/my-thp` | `alliance-hq-my-thp` | feat(thp): route Ashed and roster sync through upsertCommanderThp | 41 files changed, 3805 insertions(+), 3 deletions(-) | | |

### Trains

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `amcmillion/prompt-studio-mvp` | — | feat(trains): Prompt Studio MVP — gallery, wizard, image pipeline | 37 files changed, 3704 insertions(+), 1 deletion(-) | | |
| [ ] | `amcmillion/trains-onboarding-followup-main` | — | real-steel(Composer): restore visible dialog title | 3 files changed, 8 insertions(+), 2 deletions(-) | | |
| [ ] | `amcmillion/trains-phase-1` | — | Add train station clock + departures time | 104 files changed, 7882 insertions(+), 944 deletions(-) | | |
| [ ] | `fix/train-no-ashed-required` | — | real-steel(composer): skip donation minimums and add HQ score tests | 20 files changed, 191 insertions(+), 399 deletions(-) | | |
| [ ] | `fix/train-pool-roster-stale-sync` | — | Apply 24h roster stale sync to train pool loads. | 2 files changed, 41 insertions(+), 31 deletions(-) | | |

### UI / UX

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/form-enter-submit` | — | feat(ui): submit forms on Enter (desktop) / Send (mobile) | 34 files changed, 763 insertions(+), 219 deletions(-) | | |
| [ ] | `feat/global-loading-indicators` | `alliance-hq-global-loading-indicators` | Add shell-wide loading feedback for navigation and alliance switches. | 33 files changed, 716 insertions(+), 111 deletions(-) | | |
| [ ] | `feat/loading-local-spinners` | `alliance-hq-loading-local-spinners` | feat(ui): add local loading spinners for slow in-page actions | 10 files changed, 266 insertions(+), 102 deletions(-) | | |
| [ ] | `feat/loading-remaining` | `alliance-hq-loading-remaining` | real-steel(composer): fix OAuth stuck state and a11y busy labels | 11 files changed, 135 insertions(+), 44 deletions(-) | | |
| [ ] | `feat/system-appearance-mode` | — | Fix My VR weekly pass label contrast in light mode. | 198 files changed, 2824 insertions(+), 2427 deletions(-) | | |

### VR / Weekly pass

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `feat/my-vr-i18n` | — | feat(i18n): wire My VR page to myVr locale namespace | 6 files changed, 154 insertions(+), 117 deletions(-) | | |
| [ ] | `feat/vr-institute-level-input` | — | real-steel(Composer): parse weekly-pass picker pending from DB | 46 files changed, 1389 insertions(+), 271 deletions(-) | | |
| [ ] | `feat/vr-sandbox-mode` | — | feat(vr): alliance sandbox mode for practice reports | 58 files changed, 2327 insertions(+), 199 deletions(-) | | |
| [ ] | `feat/vr-weekly-pass` | `alliance-hq-vr-weekly` | feat(vr): weekly pass backend and drop maxBaseVr column | 42 files changed, 1061 insertions(+), 242 deletions(-) | | |
| [ ] | `feat/web-vr-tracker` | — | feat(discord): UID-only /link-commander with identity confirm | 39 files changed, 2315 insertions(+), 123 deletions(-) | | |

### Video pipeline

| Done | Branch | Worktree | Unmerged changes | Diff vs main | Disposition | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | `amcmillion/video-pipeline-observability` | — | Block 0-score validation for Zombie Siege and VS event results | 26 files changed, 1588 insertions(+), 86 deletions(-) | | |
| [ ] | `feat/video-alliance-hq-ocr-only` | — | feat(video): per-alliance in-house OCR only toggle | 15 files changed, 313 insertions(+), 33 deletions(-) | | |
| [ ] | `feat/video-lifecycle-queue` | — | fix(video): cross-device group pass selection and rematch credential | 19 files changed, 1083 insertions(+), 224 deletions(-) | | |
| [ ] | `feat/video-ocr-accuracy-badges` | — | feat(video): show in-house OCR accuracy badges on upload event types | 10 files changed, 183 insertions(+), 2 deletions(-) | | |
| [ ] | `feat/video-preview-scroll-seek` | — | Merge remote-tracking branch 'origin/main' into feat/video-preview-scroll-seek | 3 files changed, 87 insertions(+), 14 deletions(-) | | |
| [ ] | `feat/video-queue-cross-device-access` | — | fix(video): distinguish review load errors from pipeline failures | 22 files changed, 982 insertions(+), 241 deletions(-) | | |
| [ ] | `feat/video-queue-followup` | — | feat(video): enqueue-scoped queue reads without alliance context | 22 files changed, 1125 insertions(+), 243 deletions(-) | | |
| [ ] | `feat/video-review-follow-me` | — | fix(video-review): disable Follow me when preview is closed | 9 files changed, 506 insertions(+), 3 deletions(-) | | |
| [ ] | `feat/video-review-preview-tweaks` | — | fix(video): stabilize viewport snapshot to stop preview-layout render loop | 17 files changed, 726 insertions(+), 89 deletions(-) | | |
| [ ] | `feat/video-review-ux` | — | feat(video-review): fit-width zoom for portrait preview in top/bottom docks | 23 files changed, 1446 insertions(+), 290 deletions(-) | | |
| [ ] | `feat/video-survey-preview-autoplay` | — | feat(video): autoplay survey preview when upload dialog opens | 1 file changed, 21 insertions(+) | | |
| [ ] | `fix/sharp-linux-video-queue` | — | fix(video): mark jobs failed and emit SSE on processing errors | 9 files changed, 279 insertions(+), 21 deletions(-) | | |
| [ ] | `fix/video-ocr-pipeline-hardening` | — | fix(video): return to upload page after discarding review results | 19 files changed, 242 insertions(+), 52 deletions(-) | | |
| [ ] | `fix/video-review-live-refresh-clobber` | — | real-steel(Composer): reset liveJobStatusRef on jobId change | 3 files changed, 72 insertions(+), 1 deletion(-) | | |
| [ ] | `fix/video-review-rerun-ocr-feedback` | — | fix(video-review): prominent re-run OCR errors and defer loading state | 1 file changed, 106 insertions(+), 22 deletions(-) | | |
| [ ] | `video-review-preview-tweaks` | — | real-steel(Composer): tighten admin UID copy and lock profile API privacy in e2e | 19 files changed, 1146 insertions(+), 52 deletions(-) | | |

