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
- **Setup flow:** owner `/link` → `/link-alliance tag:…` → `/link-with-authentication tag key:…` (ephemeral; never audit plaintext keys). `/set-season` updates `alliances.current_season_key` for the guild's alliance.
- **i18n:** bot reply strings in `messages/*/discordBot`; slash command `description_localizations` pt-BR in `scripts/discord/register-commands.mjs`; per-user locale in `discord_user_prefs` via `/language`.
- **Deprecation:** do not reintroduce `DISCORD_ALLIANCE_ID` for new bot paths; `resolveAllianceForGuild` may fall back only for legacy deployments.

