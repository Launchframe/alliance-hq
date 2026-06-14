# Viral Resistance (VR) — product & operator guide

Alliance HQ tracks **base viral resistance** (multiples of 250, max 12750) via Discord self-report. Skills/bonus VR is out of scope.

## Season

- Configure **`alliances.current_season_key`** (game season number) in admin or `DISCORD_ALLIANCE_SEASON_KEY` for bot-only deploys.
- We store **highest base VR per member per season**, not a full within-season timeline.

## Discord commands

| Command | Purpose |
|---------|---------|
| `/link` | Link Discord user to in-game member (name + UID verification) |
| `/vr [level]` | Report or bump base VR |
| `/immunity [level]` | Alias of `/vr` |

Register: `npm run discord:register-commands`

Interactions URL: `https://<host>/api/webhooks/discord/interactions`

## Environment

See `.env.example` — `DISCORD_*`, `DISCORD_ALLIANCE_ID`, `DISCORD_ALLIANCE_SEASON_KEY`, `DISCORD_VR_REPORT_CHANNEL_ID`, optional `VR_BOT_ASHED_BEARER_TOKEN` for roster fetch during `/link`.

## Daily digest

Cron at **00:00 Server Time** (`Etc/GMT+2`) posts ranked VR to `DISCORD_VR_REPORT_CHANNEL_ID`.

## Officers

- HQ **VR leaderboard** — sort by base VR desc, then Ashed total hero power desc.
- **Officer panel** — anomaly flags (≥750 above peers when ≥10 reporters, or >10250); override API available.

## Audit

All bot interactions are logged in `discord_bot_audit`.
