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

## Real Steel review focus

Apply on every Real Steel pass for this repo:

- **RBAC enforcement** — every new/changed BFF route calls `requireSessionPermission` or equivalent; platform maintainer checks on `/admin/*` and `/api/admin/*`
- **Tenant isolation** — alliance-scoped queries filter by session alliance; admin cross-tenant reads are intentional and read-only where documented
- **Ashed sync vs manual roles** — `source: manual` memberships must not be overwritten by connect/settings sync
- **Legacy sessions** — behavior when `hq_user_id` is null (allow-all until reconnect) must remain consistent
- **Bootstrap safety** — `PLATFORM_BOOTSTRAP_EMAIL` only promotes when zero platform maintainers exist; no privilege escalation on reconnect
- **Deploy seeds** — `db:prepare` migrations/seeds idempotent; safe to run on every Vercel build
- **i18n** — new UI strings in en-US and pt-BR; run `npm run i18n:validate`
- **Video pipeline** — admin requeue/reprocess must not double-process or lose job state
- **No prod SQL for ops** — admin UI should cover role assignment, commendations, and job recovery without ad-hoc queries

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
  6. Members: `/link name:… uid:…` → links character via lastwar UID lookup + Ashed roster match.
- **`/set-season` removed** — season is derived from server age; do not reintroduce.
- **Feature flag:** `ELIGIBLE_BOT_ALLIANCE_LINK_TAGS` (comma-delimited; unset = allow all) gates `/link-to-ashed-seat` and `/link-alliance`. Check via `isTagEligible()` in `bot-setup.ts`.
- **Security invariant:** connection keys must **never** appear as slash command options or in Discord payloads. All credential submission goes through the HQ `/discord/authorize` HTTPS page. Nonces live in `discord_auth_nonces` (30-min TTL, single-use); enforced by `getValidDiscordAuthNonce` + `consumeDiscordAuthNonce`.
- **Multi-link:** up to 5 in-game characters per Discord user per alliance (`discord_member_links` unique on `(alliance_id, discord_user_id, ashed_member_id)`). `/link` adds or updates; `replace:true` clears then links one character; `/unlink` removes a link. `/vr` prompts when multiple links exist.
- **`/help`:** context-aware next steps via `resolveDiscordBotUserContext` + `pickHelpMessageKey` — guild registration, credentials, owner vs member, link count.
- **i18n:** bot reply strings in `messages/*/discordBot`; HQ authorize page strings in `messages/*/discordAuthorize`; slash command `description_localizations` pt-BR in `scripts/discord/register-commands.mjs`; per-user locale in `discord_user_prefs` via `/language`.
- **Deprecation:** do not reintroduce `DISCORD_ALLIANCE_ID` for new bot paths; `resolveAllianceForGuild` may fall back only for legacy deployments. Do not reintroduce a `key:` option on any slash command.

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

