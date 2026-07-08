# Total Hero Power (THP)

Alliance HQ tracks **total hero power** per Commander (lifetime, cross-alliance) from Power Details in Last War.

## Entry channels

| Channel | How |
|---------|-----|
| Discord `/thp` | `total` option and/or `screenshot` attachment; `/hero-power` is an alias |
| Web **My THP** | Manual total, line-item breakdown, or screenshot upload |
| Ashed sync | Roster sync continues to update the unified commander value with `source: ashed_sync` |

Prerequisite: linked commander (`/link-commander` on Discord or HQ member link on web).

## Storage

- **Current value:** `commanders.current_total_hero_power` (+ optional `current_thp_breakdown`)
- **History:** `commander_thp_events` (append-only, commander-scoped)
- **Mirror:** `alliance_members.current_total_hero_power` + `member_total_hero_power_events` for roster compatibility

## Breakdown components

When reporting from Power Details, HQ can store all seven line items:

1. Hero Level
2. Decorations & Building Stats
3. Gear
4. Exclusive Weapon
5. Hero Tier
6. Hero Skill
7. Wall of Honor

## Discord commands

Register: `npm run discord:register-commands`

| Command | Purpose |
|---------|---------|
| `/thp [total] [screenshot]` | Report total hero power |
| `/hero-power` | Alias of `/thp` |

## Web

- **My THP** (`/my-thp`) — personal tracker, history chart, alliance percentile, 30/90/180-day percentile change
- API: `GET/POST /api/thp/me`

## OCR

In-house pipeline under `src/lib/thp/hero-power-ocr/` reuses roster OCR preprocessing + Tesseract, then parses Power Details labels.

## Anomaly review

Large jumps above alliance peers (or totals above 200M) prompt Yes/No confirmation, similar to VR anomaly flow.
