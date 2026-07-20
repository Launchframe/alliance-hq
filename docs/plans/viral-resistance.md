# Viral Resistance (VR) — product & operator guide

Alliance HQ tracks **base viral resistance** (multiples of 250, max 12750) via Discord self-report. Skills/bonus VR is out of scope.

## Season

- Effective season: **owner override** → **Monday 00:05 Server Time cpt-hedge cron** → **age fallback** (caps at season 4) → default `"1"`. Full rules: [`.cursor/rules/trains.mdc`](../../.cursor/rules/trains.mdc).
- **`game_server_number`** comes from Ashed `Alliance.server_number` on connect/sync; cpt-hedge supplies `currentSeason`, post-season week, and open timestamp.
- **`DISCORD_ALLIANCE_SEASON_KEY`** remains a dev/single-tenant env override ahead of DB for VR.
- **`DISCORD_ALLIANCE_ID`** may be either **`alliances.id`** (HQ nanoid) or **`ashed_alliance_id`** (24-char hex from `/admin/alliances`); the bot resolves to the HQ row before writing audit/links.
- We store **highest base VR per member per season**, not a full within-season timeline.

## Discord commands

| Command | Purpose |
|---------|---------|
| `/link` | Link Discord account to Alliance HQ (secure browser step) |
| `/link-commander` | Link a Last War commander (name + UID verification) |
| `/vr [level]` | Report or bump base VR |
| `/immunity [level]` | Alias of `/vr` |
| `/set-vr-report-channel` | Owner: save current channel for nightly top-25 standings |
| `/vr-report [teams:N]` | Officer (R4+ or owner): ephemeral top-25 or N takedown teams (5 players each) |
| `/takedown-teams [teams:N]` | Alias of `/vr-report` |

Register: `npm run discord:register-commands`

Interactions URL: `https://<host>/api/webhooks/discord/interactions`

## Environment

See `.env.example` — `DISCORD_*`, optional legacy `DISCORD_ALLIANCE_ID` + `DISCORD_GUILD_ID`, `DISCORD_ALLIANCE_SEASON_KEY`, optional legacy `DISCORD_VR_REPORT_CHANNEL_ID`, optional `VR_BOT_ASHED_BEARER_TOKEN` for roster fetch during `/link`.

Per-guild nightly reports use `/set-vr-report-channel` (stored on `discord_guild_alliances.vr_report_channel_id`). Legacy env channel is only used when no guild rows have a channel configured.

## Daily digest

Cron at **00:00 Server Time** (`Etc/GMT+2`) posts ranked VR (top 25) to each guild's configured report channel. Owners run `/set-vr-report-channel` in the target channel after `/link-alliance`.

## Officers

- HQ **VR leaderboard** — sort by base VR desc, then Ashed total hero power desc.
- **Officer panel** — anomaly flags (≥750 above peers when ≥10 reporters); override API available.

## Audit

All bot interactions are logged in `discord_bot_audit`.
