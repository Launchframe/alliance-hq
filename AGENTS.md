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

## Parallel agents and git isolation

Concurrent Cursor agents (Multitask or separate tasks) must not share one dirty working tree. **One task → one branch → one concern**; use **git worktrees** for parallel writers. Do not use `git stash` as agent handoff — commit WIP to a topic branch instead. In this repo, Real Steel reviews run in a dedicated worktree and clean it up when done. Detail: [`.cursor/rules/agent-git-hygiene.mdc`](.cursor/rules/agent-git-hygiene.mdc), global workflow in `~/.cursor/skills/real-steel/SKILL.md`, and Alliance HQ completion (including `real-steel-ready` label) in [`.cursor/skills/real-steel/SKILL.md`](.cursor/skills/real-steel/SKILL.md).

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
- **i18n** — maintainer must approve English copy before `messages/en-US.*` or `messages/pt-BR.*` change (see [`.cursor/rules/user-facing-copy-review.mdc`](.cursor/rules/user-facing-copy-review.mdc)); then en-US + pt-BR; run `npm run i18n:validate`
- **Video pipeline** — admin requeue/reprocess must not double-process or lose job state
- **No prod SQL for ops** — admin UI should cover role assignment, commendations, and job recovery without ad-hoc queries
- **Native alliance invites** — `createHqInvite` (team settings + `/api/admin/native-alliances/.../invites`) does **not** require a linked game server; a missing alliance state server must never block invite or join-code creation. Set the state server later (owner name+UID onboarding, alliance **Game season** settings, or platform maintainer via **Admin → Alliances**). Server matching still happens at member-link time (`wrong_server`). **Commander claim invites** are member-role invites with `targetAshedMemberId` (bulk via `createHqClaimInvitesBulk`). Operator guides: `/guides/alliance-onboarding`; agent rule: `.cursor/rules/native-alliance-invites-rbac.mdc`.
- **Trains** — GET routes use `scores:read`; mutations use `trains:write` via `requireTrainOfficer`; tenant-scoped by session alliance; conductor lock is immutable without audited override; season + ritual detail in [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc)
- **Hotkey registry** — new navigable pages and primary dashboard actions should register in [`src/lib/hotkeys/actions.registry.ts`](src/lib/hotkeys/actions.registry.ts) with defaults, i18n labels, and permission gates; see [`.cursor/rules/hotkey-registry.mdc`](.cursor/rules/hotkey-registry.mdc)

## Last War domain (game mechanics)

Alliance HQ models **in-game** alliance mechanics (trains, VS weeks, R1–R5 ranks) separately from **HQ RBAC** and Ashed iframe pages. Game server time is **UTC−2**; VS match weeks run Mon–Sat with Sunday off; calendar weeks start Monday 00:00 server time.

- Alliance ranks **R1–R5** are stored in immutable **`member_alliance_rank_events`**; confirmed changes dual-write to Ashed `Member` and update **`alliance_members`** (locally synced roster with normalized rank/title). Members page refresh syncs from Ashed; train pools read local roster, not live Ashed queries.
- Train conductor mutations require **`trains:write`** (owner/maintainer/officer — not `data_entry`).
- **Game season** — owner override → Monday cpt-hedge cron → age fallback (caps S4) → default `"1"`; see [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc).
- Full terminology and train rules: [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc) (ranks + server time: [`.cursor/rules/alliance-affairs.mdc`](.cursor/rules/alliance-affairs.mdc)).
- **Season 5 Bank Strongholds** — ownership lifecycle (Looting → Investible; wild vs alliance via `priorCaptureCount`), deposit pairing (blue/green/orange + synthetics), City List OCR upsert, and drop optimization: [`.cursor/rules/season-5-bank-deposits.mdc`](.cursor/rules/season-5-bank-deposits.mdc).

## Discord bot: multi-tenant architecture

- **Tenant key:** `discord_guild_alliances.guild_id` → `alliances.id` after `/link-alliance`. User-facing identity is **alliance tag only** (case-insensitive, e.g. `LFgo`) — never expose or accept `alliances.id`, `ashed_alliance_id`, or env-based alliance ids in bot commands or replies.
- **Tag disambiguation:** multiple HQ rows with the same tag → filter by caller's `discord_member_links` roster match, then optional `name` on `/link-alliance`; pending kind `pick_alliance_by_name` when still ambiguous.
- **Credentials:** per-alliance Ashed JWT in `alliance_ashed_credentials` (encrypted with `TOKEN_ENCRYPTION_KEY`). Resolve via `getAllianceAshedCredential` → `loadAllianceMembersForBot`.
- **JWT scope:** never call Ashed with a credential for a different alliance. `loadAllianceMembersForBot` is the sole member-read entry point for bot code. Legacy `VR_BOT_ASHED_BEARER_TOKEN` requires matching `VR_BOT_ASHED_ALLIANCE_TAG`.
- **Setup flow (secure):**
  1. Anyone: `/link` → ephemeral HQ authorize URL (`purpose=user_link`) → Discord OAuth → `discord_hq_links` (no alliance required). Also mirrors any existing `hq_member_links` into `discord_member_links` so bot commands do not require a second name+UID pass.
  2. Owner (optional Ashed path): `/link-ashed tag:LFgo` → ephemeral HQ authorize URL (`purpose=alliance_credentials`) for roster sync tools (requires step 1).
  3. Owner completes HQ `/discord/authorize` with connection key only when using step 2 (stores `alliance_ashed_credentials`).
  4. Owner or platform maintainer: `/link-alliance tag:LFgo` → `discord_guild_alliances` (owner via member link / `callerIsAllianceOwner`, or platform maintainer — **no Ashed or HQ link required** for native alliances).
  5. Owner: `/set-vr-report-channel` in the nightly standings channel.
  6. Members: `/link-commander` or `/link-last-war-profile` (alias) → secure web form → `discord_member_links` when they have not already linked on the web. If they linked a commander on HQ web and then `/link`, commanders are inherited automatically (lazy inherit also runs on `/vr`, help, and owner/officer gates).
- **Ashed optional:** Ashed credentials are never required for auth or member link. See [`.cursor/rules/ashed-optional-auth.mdc`](.cursor/rules/ashed-optional-auth.mdc).
- **VR reports:** `/vr-report` (top 25) and `/vr-report teams:N` / `/takedown-teams` (5-player rally teams, snake THP balance) are **officer-gated** (`callerCanRunVrReport`: R4+ linked member or owner). Replies are **channel-visible** so the alliance can read standings and takedown teams; nightly cron also posts public top-25 to each guild's configured channel via `loadAllianceLeaderboard` + `listRegisteredGuildsWithReportChannel`. **`/what-is-my-vr`** and **`/what-is-my-thp`** are public status queries for the caller's linked commanders (name + VR/THP only — never UID).
- **Train commands:** `/set-train-channel` (owner), `/who-is-conductor`, `/set-conductor`, `/train-is-ready` (officer gate via `callerCanManageTrains` → same as VR reports). Guild tenant from registration only; alliance-level `train_discord_announcements_enabled` (HQ settings) + per-guild `train_channel_id`. Lock/announce shared logic in `lib/trains/discord-bot.server.ts`; HQ lock route calls `maybeAnnounceTrainReady`. Departing-soon cron: `/api/internal/train/departing-soon`. Operator guide: `/guides/discord-train` (source `docs/guides/discord-train-operator.md`, en-US only until translated).
- **`/set-season` removed** — season is derived from server age; do not reintroduce.
- **Feature flag:** `ELIGIBLE_BOT_ALLIANCE_LINK_TAGS` (comma-delimited; unset = allow all) gates `/link-ashed` and `/link-alliance`. Check via `isTagEligible()` in `bot-setup.ts`.
- **Security invariant:** Ashed connection keys must **never** appear as slash command options or in Discord payloads. Credential submission uses the HQ `/discord/authorize` HTTPS page (`alliance_credentials` only). HQ account link uses Discord OAuth on that page (`user_link`). Commander link uses player ID entry on `/discord/link-commander` (`member_link` nonce from `/link-commander` / `/link-last-war-profile`) only. Nonces live in `discord_auth_nonces` (`purpose`: `alliance_credentials` | `user_link` | `member_link`; 30-min TTL, single-use).
- **Multi-link:** up to 5 commanders per Discord user per alliance (`discord_member_links`). `/link-commander` or `/link-last-war-profile` adds or updates; `replace:true` clears then links one; `/unlink` removes a row. `/vr` prompts when multiple commanders exist.
- **`/help`:** context-aware next steps via `resolveDiscordBotUserContext` + `pickHelpMessageKey` — guild registration, credentials, owner vs member, link count.
- **i18n:** bot reply strings in `messages/*/discordBot`; HQ authorize page strings in `messages/*/discordAuthorize`; slash command `description_localizations` pt-BR in `scripts/discord/register-commands.mjs`; per-user locale in `discord_user_prefs` via `/language`.
- **Deprecation:** do not reintroduce `DISCORD_ALLIANCE_ID` for multi-tenant hosted deploys. `resolveAllianceForGuild` falls back to env only when `guildId === DISCORD_GUILD_ID` (legacy single-server). Unregistered guilds must get `errors.guildNotRegistered`, not a silent wrong-alliance roster lookup. Do not reintroduce a `key:` option on any slash command.

## Discord bot — identity and auth layers

Do **not** conflate **Discord user**, **`discord_member_links` (in-game member)**, **HQ user / session RBAC**, and **Ashed JWT / roster**. They answer different questions on different entry paths (Discord webhook, HQ web, cron/internal).

| Layer | Identity | Typical entry |
| --- | --- | --- |
| Discord bot (HQ identity) | `discord_hq_links` | `/link` → Discord OAuth (`user_link` nonce) — no alliance required |
| Discord bot (member link) | `discord_member_links` per guild alliance | `/link-commander` or `/link-last-war-profile` → secure web form (`member_link` nonce) |
| Discord bot (optional Ashed) | `alliance_ashed_credentials` | `/link-ashed` for roster reads / Ashed tools — not auth |
| HQ web | `hq_users` + `alliance_memberships` / session permission | BFF routes with `requireSessionPermission` |
| Ashed | Roster, owner, collaborators — **source of truth** for in-game membership | User connect JWT (web) or `alliance_ashed_credentials` (bot roster reads) |

- **Member actions** (`/link-commander`, `/link-last-war-profile`, `/vr`): prove Discord user ↔ in-game commander via player ID on the secure web form (or inherited HQ link); guild tenant from `resolveAllianceForGuild`.
- **HQ account link** (`/link`): Discord OAuth via `user_link` nonce; records `discord_hq_links`; works without a registered guild; inherits web commanders into `discord_member_links`.
- **Owner setup** (`/link-alliance`, optional `/link-ashed`): guild registration via owner member link or platform maintainer; Ashed credentials optional for native alliances.
- **Cron / web-triggered jobs:** service or session auth; resolve `allianceId` explicitly; do not impersonate a Discord user.

### Privileged linking (owner / officer / platform maintainer)

Name+UID member link (`/onboard`, `/link-commander`, `/link-last-war-profile`) proves Last War API consistency. **HQ web RBAC** for invited owner/officer roles comes from the invite, not Ashed. Discord native setup also uses name+UID member links for owner proof; `/link-ashed` is optional for Ashed-powered tools.

| Surface | Rule |
| --- | --- |
| Web `/onboard` | All invite roles: **name+UID member link** after accept (`MemberLinkOnboardingWizard`). Ashed connect is optional (iframe tools / roster sync). |
| HQ RBAC | Manual `owner` / `officer` memberships grant role permissions from the invite. Platform maintainers get `hq:admin` from the maintainer flag. **Ashed-sourced** memberships still require a matching live session credential (unchanged). |
| Discord owner gate | `callerIsAllianceOwner` requires a Discord member link whose `ashedMemberId` matches `alliances.ownerMemberExternalId`; Ashed credentials are not required for owner proof. |
| Discord officer gate | R4+ checks use the alliance-scoped local roster when present. Optional Ashed credentials may supply roster reads for Ashed-sourced alliances that have no local roster yet. |
| Token storage | Web connects and `/link-ashed` credentials cap `tokenExpiresAt` at **min(JWT exp, browser session expiresAt)**. |

Legacy sessions (`hqUserId` null): allow-all until reconnect (unchanged). Regular `member` / `data_entry` / `viewer` invites: name+UID link only.

**Commander vs HQ user vs roster:** Invite accept creates **`alliance_memberships` (RBAC)** only; **`hq_member_links`** is a separate exact UID + roster bind. Three name sources (typed, Last War API, `alliance_members`) must not be fuzzy-merged — see [`.cursor/rules/invite-commander-identity.mdc`](.cursor/rules/invite-commander-identity.mdc).

**Player UID privacy:** treat Last War player UIDs / `game_uid` as sensitive account-binding data — never display them, never log them, and never allow name+UID to relink a claimed Commander without account-level security; see [`.cursor/rules/player-uid-privacy.mdc`](.cursor/rules/player-uid-privacy.mdc).

Detail: [`.cursor/rules/discord-identity-auth-layers.mdc`](.cursor/rules/discord-identity-auth-layers.mdc) (architecture) and [`.cursor/rules/discord-bot-multitenancy.mdc`](.cursor/rules/discord-bot-multitenancy.mdc) (tenant + credentials guardrails).

## Learned User Preferences

- Rebase stacked child PRs (`git rebase --onto`) when the parent was pre-rebase — do not merge conflict resolutions into the child.
- Propagate Drizzle renumbers parent→child in stacked work; never drop migration SQL or `_journal.json` entries on rebase or force-push.
- Maintainer must review and approve release notes before `release:ship`; set note frontmatter `status: ready` only after approval.
- Real Steel: when Discord or onboarding hosted-guide copy changes, verify operator guides and `e2e/discord-bot-guide.spec.ts`.
- Start feature work from new git worktrees off `origin/main`.
- Hotkey changes need fault isolation and compile-time target validation for navigable pages.
- Member-facing copy must never mention platform admins or maintainers; say alliance officers were notified instead.
- Run `npm run test:e2e` before pushing PR branch updates.

## Learned Workspace Facts

- Migration renumbering after `0004` is SQL file rename plus `_journal.json` update (Drizzle snapshots only cover `0000`–`0004`).
- Reserve migration sequence numbers for in-flight PRs in stacked work.
- `db:validate-journal` allows intentional sequence gaps in `_journal.json`.
- Discord `/link-commander` matches web member-link: UID-only lookup plus identity confirm (no typed in-game name).
- Roster substring match direction: roster name (≥4 chars) must be a subset of the in-game name, with a single match.
- Release workflow: draft notes in `docs/release-notes/` (`status: draft`); push `package.json` bump and `status: ready` note for cross-machine ship; run `npm run release:ship -- --yes --version X.Y.Z` (not `--minor` when `package.json` is already bumped).
- E2e “no linked game server” fixtures: null `game_server_id` only — keep `game_server_number` NOT NULL on `alliances`.
- HQ `ROSTER_MAX_MEMBERS` is intentionally 2× the in-game alliance cap (200 vs 100) during onboarding tuning so missed roster matches still leave room for full JIT linking; may lower as tooling improves.
- Discord-first users who have not run `/link` hit cross-layer UID conflicts on web self-service; self-service path is Discord `/link` then retry web — officer help queue (`cross_layer_claim` / `discord_hq_unlinked`) mediates stuck cases.
- No synthetic default alliance tag (e.g. `HQ`) in invite/welcome URLs; unset `alliances.tag` needs explicit officer-visible handling, not a URL fallback.
- Roster sync no longer upserts `hq_users` stubs for unknown roster emails — Ashed-sourced officer memberships require invite accept or SSO connect.
- Keep native OCR deps (sharp/libvips) scoped to video-process routes; tracing or imports that pull them into other serverless handlers break unrelated endpoints.

