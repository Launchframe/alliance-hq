# Event upload reminder schedules (EUR)

Alliance officers configure **when** the alliance should be reminded to upload event scores. Reminders appear in the officer **Reminder inbox** (`/inbox`), separate from the platform **Ops inbox** (`/admin/inbox`).

## Server time

Schedules use **server calendar time** (UTC−2 via `lib/trains/game-time.ts`). Weekly slots use day-of-week `0 = Sunday` … `6 = Saturday` and `timeSt` as `HH:MM` in that zone.

## LFgo example mapping

Use these as reference when seeding or configuring `eur_schedule_rules` for a similar alliance — not hardcoded in production code.

| Event | `schedule_kind` | Config sketch |
|-------|-----------------|---------------|
| Alliance Exercise | `interval_after_last` | `interval_days: 2`, `anchor_time_st: "00:15"` |
| Zombie Siege | `weekly` | Tue `00:45`, Fri `00:15` (two weekly slot rows or one rule with two slots) |
| Donations | `weekly` | Mon `00:00` |
| Canyon Storm | `weekly` | Thu `23:00` |
| Desert Storm | `weekly` | Fri `23:00` |
| Sunday AE | `weekly` | Sun `00:15` |
| Custom Saturday | `custom_label` + weekly | Sat `13:00` |

`reminder_delay_minutes` is added after the scheduled start (e.g. AE at 00:15 ST + 60 → reminder at 01:15 ST).

## Satisfaction

An open occurrence is **satisfied** when a `video_jobs` row exists for the same alliance and `score_target` with status `review`, `submitting`, or `complete` and `updated_at` (or `created_at`) on or after the occurrence’s `scheduled_start_at`.

After satisfaction, EUR inbox items are deactivated. Users with `upload:write` may see a `video_jobs_pending` item when jobs remain in `review`.

## Cron

`GET /api/internal/cron/eur-tick` (Vercel cron every 10 minutes, `CRON_SECRET` bearer) generates occurrences for the next 48h and materializes due reminders into `inbox_reminder_items`.
