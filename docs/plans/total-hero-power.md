# Total Hero Power (THP)

Alliance HQ tracks **total hero power** per Commander (lifetime, cross-alliance) from Power Details in Last War.

## Entry channels

| Channel | How |
|---------|-----|
| Discord `/thp` | `total` option and/or `screenshot` attachment; `/hero-power` is an alias |
| Web **My THP** | Manual total, line-item breakdown, or screenshot upload |
| Ashed sync / roster import | `syncCommanderFromAllianceMember` → `upsertCommanderThp` (`ashed_sync`, `roster_import`, `video_parse`) |

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

Geometry-first pipeline under `src/lib/thp/hero-power-ocr/`:

1. **Label column** (left ~60% of modal) — letter OCR → `THP_LABEL_ALIASES` (EN/DE/pt-BR/KO/es-MX). Row order is **not** fixed.
2. **Value column** (right ~45%) — **digits-only** whitelist so freeform comma→digit totals (`164376153505`) cannot be accepted as headers. Dual polarity (normal + inverted) because section bars are white-on-grey while component rows are dark-on-light.
3. **Y-zip** pairs each label to the nearest value by normalized y-center; stop at Drone/Building.
4. **Narrow normalize** (`normalizeDigitsOnlyComponent`) only undoes separator-slot pollution when Tesseract still maps a comma onto `1`/`7` — not the old combinatorial digit-repair search.
5. `complete` only when all seven components sum to the header (or the sum is used when the white-on-grey header total is missing from OCR).

Freeform full-modal Tesseract in `parse-power-details.ts` remains for unit fixtures / emergency only.

```bash
# Architecture / regression (no Tesseract download)
npx vitest run src/lib/thp/hero-power-ocr/parse-power-details-geometry.shared.test.ts

# Live screenshot (optional)
THP_OCR_LIVE=1 npx vitest run src/lib/thp/hero-power-ocr/parse-power-details-image.live.test.ts
# Pixel-perfect totals (stricter; may still fail on glyph quality)
THP_OCR_LIVE=1 THP_OCR_LIVE_STRICT=1 npx vitest run src/lib/thp/hero-power-ocr/parse-power-details-image.live.test.ts
```

## Anomaly review

Large jumps above alliance peers (or totals above 200M) prompt Yes/No confirmation, similar to VR anomaly flow.
