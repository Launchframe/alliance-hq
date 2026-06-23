<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Pre-commit gates

Before creating a commit, all checks in [`PRE-COMMIT.md`](./PRE-COMMIT.md) must pass, in order:

1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm run test`

Do not commit while any gate is failing.

## Drizzle migrations and `_journal.json`

`db:prepare` (every Vercel build) applies migrations listed in **`drizzle/meta/_journal.json` only**. A `drizzle/NNNN_*.sql` file without a journal entry **never runs on deploy**.

| Change type | Workflow |
| --- | --- |
| **Schema from `src/db/schema.ts`** | `npm run db:generate` — creates/updates SQL **and** journal |
| **Hand-written SQL** (data backfill, idempotent DDL) | Add `drizzle/NNNN_descriptive_name.sql` **and** append `{ "tag": "NNNN_descriptive_name", … }` to `_journal.json` |
| **Before commit** | `npm run db:validate-journal` (also runs in the Husky pre-commit hook) |

**PR rule:** if `drizzle/*.sql` is new or changed, `drizzle/meta/_journal.json` must change in the same commit. Pre-commit fails when a numbered migration SQL file on disk is missing from the journal, or when a **staged new** `.sql` file has no matching journal tag.

## E2E plan completion

Feature work is not done until Playwright e2e is green — see [`.cursor/rules/e2e-plan-completion.mdc`](.cursor/rules/e2e-plan-completion.mdc). Update `e2e/**/*.spec.ts` and `e2e/fixtures/**` when auth, invite, connect, or session isolation changes; run `npm run test:e2e` before marking a plan complete or opening a PR.

## Client vs server imports (Next.js bundles)

**`"use client"` components and hooks must not import modules that pull in Node or Postgres.** Next will try to bundle those for the browser and fail (`Can't resolve 'fs'`, `postgres`, etc.).

Before wiring a client component to shared logic, trace the import chain:

| Safe in client | Server-only — never import from `"use client"` |
| --- | --- |
| Pure helpers, types, formatters under `lib/` with no DB/session | `@/lib/db`, `@/lib/session`, `@/lib/trains/rank-sync`, Prisma/postgres, `fs`/`path`/`crypto` server helpers |
| `*.shared.ts` modules (explicit client-safe surface) | API route handlers, `*.server.ts` modules marked `import "server-only"` |

**Pattern:** put optimistic UI / validation in `feature.shared.ts`; keep mutations in `feature.server.ts` (top line: `import "server-only"`) or route handlers. Client code calls `fetch('/api/…')` instead of importing server libs.

**Smell:** a new `lib/` helper imported by both a page client component and an API route — split it immediately; do not re-export server code from the same barrel the client uses.

## Real Steel review focus

Apply on every Real Steel pass for this repo:

- **Client bundle hygiene** — `"use client"` files must not transitively import `@/lib/db`, `@/lib/session`, rank-sync, or other server-only modules; use `*.shared.ts` + API routes (see **Client vs server imports** above)
- **RBAC enforcement** — every new/changed BFF route calls `requireSessionPermission` or equivalent; platform maintainer checks on `/admin/*` and `/api/admin/*`
- **Tenant isolation** — alliance-scoped queries filter by session alliance; admin cross-tenant reads are intentional and read-only where documented
- **Ashed sync vs manual roles** — `source: manual` memberships must not be overwritten by connect/settings sync
- **Legacy sessions** — behavior when `hq_user_id` is null (allow-all until reconnect) must remain consistent
- **Bootstrap safety** — `PLATFORM_BOOTSTRAP_EMAIL` only promotes when zero platform maintainers exist; no privilege escalation on reconnect
- **Deploy seeds** — `db:prepare` migrations/seeds idempotent; safe to run on every Vercel build; every `drizzle/NNNN_*.sql` must appear in `drizzle/meta/_journal.json` (`npm run db:validate-journal`)
- **i18n** — new UI strings in en-US and pt-BR; run `npm run i18n:validate`
- **Video pipeline** — admin requeue/reprocess must not double-process or lose job state
- **No prod SQL for ops** — admin UI should cover role assignment, commendations, and job recovery without ad-hoc queries
- **Trains** — GET routes use `scores:read`; mutations use `trains:write` via `requireTrainOfficer`; tenant-scoped by session alliance; conductor lock is immutable without audited override; season + ritual detail in [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc)

## Last War domain (game mechanics)

Alliance HQ models **in-game** alliance mechanics (trains, VS weeks, R1–R5 ranks) separately from **HQ RBAC** and Ashed iframe pages. Game server time is **UTC−2**; VS match weeks run Mon–Sat with Sunday off; calendar weeks start Monday 00:00 server time.

- Alliance ranks **R1–R5** are stored in immutable **`member_alliance_rank_events`**; confirmed changes dual-write to Ashed `Member` and update **`alliance_members`** (locally synced roster with normalized rank/title). Members page refresh syncs from Ashed; train pools read local roster, not live Ashed queries.
- Train conductor mutations require **`trains:write`** (owner/maintainer/officer — not `data_entry`).
- **Game season** — owner override → Monday cpt-hedge cron → age fallback (caps S4) → default `"1"`; see [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc).
- Full terminology and train rules: [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc) (ranks + server time: [`.cursor/rules/alliance-affairs.mdc`](.cursor/rules/alliance-affairs.mdc)).

## Discord bot: multi-tenant architecture

- **Tenant key:** `discord_guild_alliances.guild_id` → `alliances.id` after `/link-alliance`. User-facing identity is **alliance tag only** (case-insensitive, e.g. `LFgo`) — never expose or accept `alliances.id`, `ashed_alliance_id`, or env-based alliance ids in bot commands or replies.
- **Tag disambiguation:** multiple HQ rows with the same tag → filter by caller's `discord_member_links` roster match, then optional `name` on `/link-alliance`; pending kind `pick_alliance_by_name` when still ambiguous.
- **Credentials:** per-alliance Ashed JWT in `alliance_ashed_credentials` (encrypted with `TOKEN_ENCRYPTION_KEY`). Resolve via `getAllianceAshedCredential` → `loadAllianceMembersForBot`.
- **JWT scope:** never call Ashed with a credential for a different alliance. `loadAllianceMembersForBot` is the sole member-read entry point for bot code. Legacy `VR_BOT_ASHED_BEARER_TOKEN` requires matching `VR_BOT_ASHED_ALLIANCE_TAG`.
- **Setup flow (secure):**
  1. Owner: `/link-to-ashed-seat tag:LFgo` → bot creates a 30-min nonce → returns ephemeral HQ URL.
  2. Owner: opens `NEXT_PUBLIC_APP_URL/discord/authorize?nonce=…` in browser; signs in to HQ if needed; enters connection key on the HTTPS form — key never travels through Discord.
  3. HQ `POST /api/discord/authorize`: verifies key, checks Ashed owner role, calls `syncAshedAllianceForBot`, stores encrypted credential (does **not** register guild — that is `/link-alliance` only).
  4. Owner: `/link name:… uid:…` → links their in-game character (now `callerIsAllianceOwner` becomes true since `ownerAshedUserId` is set).
  5. Owner: `/link-alliance tag:LFgo` → registers guild (`upsertGuildAlliance`); required before members can `/link`.
  6. Owner: `/set-vr-report-channel` in the nightly standings channel (stores `discord_guild_alliances.vr_report_channel_id`).
  7. Members: `/link name:… uid:…` → links character via lastwar UID lookup + Ashed roster match.
- **VR reports:** `/vr-report` (top 25) and `/vr-report teams:N` / `/takedown-teams` (5-player rally teams, snake THP balance) are **officer-gated** (`callerCanRunVrReport`: R4+ linked member or owner). Replies are ephemeral; nightly cron posts public top-25 to each guild's configured channel via `loadAllianceLeaderboard` + `listRegisteredGuildsWithReportChannel`.
- **`/set-season` removed** — season is derived from server age; do not reintroduce.
- **Feature flag:** `ELIGIBLE_BOT_ALLIANCE_LINK_TAGS` (comma-delimited; unset = allow all) gates `/link-to-ashed-seat` and `/link-alliance`. Check via `isTagEligible()` in `bot-setup.ts`.
- **Security invariant:** connection keys must **never** appear as slash command options or in Discord payloads. All credential submission goes through the HQ `/discord/authorize` HTTPS page. Nonces live in `discord_auth_nonces` (30-min TTL, single-use); enforced by `getValidDiscordAuthNonce` + `consumeDiscordAuthNonce`.
- **Multi-link:** up to 5 in-game characters per Discord user per alliance (`discord_member_links` unique on `(alliance_id, discord_user_id, ashed_member_id)`). `/link` adds or updates; `replace:true` clears then links one character; `/unlink` removes a link. `/vr` prompts when multiple links exist.
- **`/help`:** context-aware next steps via `resolveDiscordBotUserContext` + `pickHelpMessageKey` — guild registration, credentials, owner vs member, link count.
- **i18n:** bot reply strings in `messages/*/discordBot`; HQ authorize page strings in `messages/*/discordAuthorize`; slash command `description_localizations` pt-BR in `scripts/discord/register-commands.mjs`; per-user locale in `discord_user_prefs` via `/language`.
- **Deprecation:** do not reintroduce `DISCORD_ALLIANCE_ID` for multi-tenant hosted deploys. `resolveAllianceForGuild` falls back to env only when `guildId === DISCORD_GUILD_ID` (legacy single-server). Unregistered guilds must get `errors.guildNotRegistered`, not a silent wrong-alliance roster lookup. Do not reintroduce a `key:` option on any slash command.

## Discord bot — identity and auth layers

Do **not** conflate **Discord user**, **`discord_member_links` (in-game member)**, **HQ user / session RBAC**, and **Ashed JWT / roster**. They answer different questions on different entry paths (Discord webhook, HQ web, cron/internal).

| Layer | Identity | Typical entry |
| --- | --- | --- |
| Discord bot | `discord_user_id` + member link row(s) per alliance | `/api/webhooks/discord/interactions` |
| HQ web | `hq_users` + `alliance_memberships` / session permission | BFF routes with `requireSessionPermission` |
| Ashed | Roster, owner, collaborators — **source of truth** for in-game membership | User connect JWT (web) or `alliance_ashed_credentials` (bot roster reads) |

- **Member actions** (`/link`, `/vr`, future quick tasks): prove Discord user ↔ in-game character via `/link` + optional multi-character picker.
- **Owner setup** (`/link-alliance`, `/link-with-authentication`): prove alliance owner via linked `ownerAshedUserId` or Ashed owner JWT — not merely “has an HQ login.”
- **Cron / web-triggered jobs:** service or session auth; resolve `allianceId` explicitly; do not impersonate a Discord user.

Detail: [`.cursor/rules/discord-identity-auth-layers.mdc`](.cursor/rules/discord-identity-auth-layers.mdc) (architecture) and [`.cursor/rules/discord-bot-multitenancy.mdc`](.cursor/rules/discord-bot-multitenancy.mdc) (tenant + credentials guardrails).

