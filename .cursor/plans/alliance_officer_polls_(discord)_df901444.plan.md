---
name: Alliance officer polls (Discord)
overview: Build native, alliance-scoped officer polling/voting into Alliance HQ (web + Discord bot), using lastwar-server1586 purely as a source of ideas — not code — and keep member-facing UI on the existing hq-* token system rather than adopting HeroUI.
todos:
  - id: copy-catalog
    content: Draft copy catalog (web + Discord bot strings + slash command description) and get maintainer approval before writing code
    status: pending
  - id: schema
    content: Add alliance_polls + alliance_poll_votes Drizzle tables and migration
    status: pending
  - id: rbac
    content: Add polls:write permission and callerCanManagePolls officer gate (wraps callerCanRunVrReport)
    status: pending
  - id: discord-bot
    content: Add /poll slash command + handlers + /set-poll-channel, register in register-commands.mjs
    status: pending
  - id: cron
    content: Add /api/internal/polls/finalize cron route for expiry/early-close/announce
    status: pending
  - id: web-ui
    content: Build /polls page with existing hq-* tokens and UI primitives (no HeroUI)
    status: pending
  - id: i18n
    content: Fill en-US + pt-BR + Discord localizations from approved copy, run npm run i18n:validate
    status: pending
  - id: e2e
    content: Add Playwright coverage for poll create/vote/finalize and permission gates
    status: pending
isProject: false
---


# Alliance officer polls & voting (native build, no HeroUI, no code reuse)

## Findings that shape this plan

**1. lastwar-server1586 is not actually open source.** `gh api repos/k33bz/lastwar-server1586` returns no `license`; `GET /contents/LICENSE` is a **404** (file doesn't exist), yet its `README.md` displays a `License: Private` badge pointing at that missing file. There is no license grant of any kind — this is a publicly *readable* private-licensed repo, not OSS. **Conclusion: do not copy any of their PHP, JS, JSON schemas, React/HeroUI components, or image assets.** Ideas, data shapes, and workflow concepts (not literal expression) are fair to learn from and reimplement independently, which is exactly what this plan does.

**2. It's a fundamentally different stack and tenancy model**, not something we can "spin up for server 1203":
- PHP 8 + flat JSON files (`data/*.json`) with file locks, no relational DB, deployed via FTP/cPanel.
- A **discord.js persistent Node bot** (long-running process) vs. Alliance HQ's **serverless webhook bot** (`src/app/api/webhooks/discord/interactions/route.ts`).
- Their "multi-server" support (`docs/MULTI_SERVER_DEPLOYMENT.md`) is one **shared PHP/JSON backend for every game server**, with a separately-built-and-deployed React public site per server (env-var `VITE_SERVER_ID`). It is a different multi-tenancy shape than Alliance HQ's per-`alliances.id` RBAC/session/Discord-guild tenant model, and per their own `docs/HEROUI_MIGRATION.md` most of it (admin panel, forms, backend API) is still **pending**, not shipped.
- Every data file (alliance tags, Discord IDs, logos) is server-1586-specific; there is no portable "install for server 1203" path even ignoring the license.
- **Conclusion:** don't fork/deploy their app for 1203. If broader server-wide council/NAP tooling is wanted later, treat it as a fresh Alliance HQ feature (see Future scope below), not a migration of their code.

**3. Scope decision (per your answer):** build **alliance-internal officer polls**, not a cross-alliance server council. This fits Alliance HQ's existing per-alliance tenant model directly — no new cross-alliance entity needed now. (Alliance HQ already tracks `alliances.gameServerNumber`, so a future cross-alliance "server council" phase remains possible without a schema rewrite — noted as Future scope, not part of this plan.)

**4. UI decision (per your answer):** keep the existing `hq-*` design-token system (`src/app/globals.css`, hand-rolled primitives in `src/components/ui/`). No HeroUI. HeroUI v3 is itself alpha software (`3.0.0-beta.1`) with its own oklch theme system that would fight `.cursor/rules/hq-theming.mdc`, and the source repo's own HeroUI migration is incomplete (only the public homepage, not admin/forms). Raise visual polish on the new polls UI using existing tokens + primitives instead.

## What to build (ideas borrowed, implementation native)

Borrow the **workflow shape** from `lastwar-server1586`'s Discord vote system, reimplemented on Alliance HQ's actual stack:

| Their concept | Alliance HQ implementation |
| --- | --- |
| `/vote request` → president approve/reject → DM ballot → auto-finalize | New `/poll` slash command in `scripts/discord/register-commands.mjs` + handler in a new `src/lib/polls/discord-bot-handlers.server.ts`, following the pattern of `src/lib/trains/discord-bot-handlers.server.ts` |
| Officer/president gate | Reuse `callerCanRunVrReport` (`src/lib/vr/bot-officer-auth.ts`) for poll creation — same "owner or linked R4+ commander" gate already used by `callerCanManageTrains` (`src/lib/trains/discord-bot-auth.server.ts`). Add a matching **`polls:write`** HQ permission in `src/lib/rbac/constants.ts` (alongside `TRAINS_WRITE_PERMISSION`) for the web side |
| `discord-votes.json` + SHA-256 hash chain for tamper evidence | Two Postgres tables via Drizzle: `alliance_polls` (id, allianceId, title, description, createdByMemberId, status, expiresAt, finalizedAt) and `alliance_poll_votes` (pollId, voterMemberId, choice enum `yes/no/abstain`, castAt) — **append-only**, one row per vote, same immutable-event-log pattern already used for `member_alliance_rank_events`. No hash chain needed; Postgres + no-update policy gives equivalent tamper evidence with far less code |
| 24h timer / all-votes-in early close, 12h president auto-approve | New Vercel Cron route `src/app/api/internal/polls/finalize/route.ts`, modeled on `src/app/api/internal/train/departing-soon/route.ts` + `CRON_SECRET` auth |
| R4 vote delegation (R5 absent) | Skip for v1 — Alliance HQ's officer gate already treats "owner or any linked R4+" as eligible; add explicit delegation only if the maintainer asks for it after seeing v1 |
| Results posted to Discord channel + website | Reuse the per-alliance announcement-channel pattern (`train_channel_id` / `/set-train-channel`) — add `poll_channel_id` + `/set-poll-channel` (owner-gated, same shape as `DiscordTrainChannelSetupLinks.tsx` flow) |
| Web "Votes Management" admin page | New `/[locale]/(app)/polls` page using existing `src/components/ui/dialog.tsx`, `button.tsx`, `checkbox.tsx`, and the `ResponsiveRecordViews.tsx` pattern for mobile-first cards — styled entirely with `hq-*` tokens per `hq-theming.mdc` |

## Copy review gate (hard blocker before implementation)

Per `.cursor/rules/user-facing-copy-review.mdc` and `i18n-all-surfaces.mdc`, before writing any code:

1. Draft a copy catalog: all new web strings (poll create/detail/results UI), Discord bot reply strings (`messages/*/discordBot`), and the new `/poll` slash command's `description_localizations` in `scripts/discord/register-commands.mjs`.
2. Present that catalog in chat for maintainer approval (English only at this stage).
3. Only after approval: wire i18n keys, fill `messages/en-US.json`, hand-translate `messages/pt-BR.json`, run `npm run i18n:validate`.

## Explicitly out of scope for this plan

- Any cross-alliance / server-wide council, NAP signatories, or council rotation across multiple alliances on server 1203 (deferred — would need a new "game server tenant" concept grouping alliances by `gameServerNumber`; revisit only if you want that bigger scope later).
- HeroUI adoption anywhere in the app.
- Any file, asset, or code copied from `k33bz/lastwar-server1586`.
- R4 delegation, rotation scheduling, NAP amendment/versioning system.

## Suggested build order

1. **Copy catalog** for maintainer approval (blocking gate above).
2. **Schema**: `alliance_polls` + `alliance_poll_votes` tables (`npm run db:generate`, journal entry).
3. **RBAC**: `polls:write` permission (web) + `callerCanManagePolls` (bot, wraps `callerCanRunVrReport`).
4. **Discord bot**: `/poll create|vote|status|results|close` command + handlers + `/set-poll-channel`.
5. **Cron**: `/api/internal/polls/finalize` (expiry + early-close + Discord/HQ announce).
6. **Web UI**: `/polls` page (list, detail, results) using existing `hq-*` primitives.
7. **i18n**: en-US + pt-BR + Discord localizations, `npm run i18n:validate`.
8. **E2E**: new Playwright coverage per `.cursor/rules/e2e-plan-completion.mdc` (poll create/vote/finalize, permission gate negative cases).
