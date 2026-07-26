---
name: triage
description: Investigate Alliance HQ production incidents — Sentry issues, health checks, cron failures, and ops alerts. Use when the user reports outages, 5xx spikes, login failures, Discord/email alert failures, or cron/alert failures.
---

# Alliance HQ incident triage

## When to use

- Production outage or degraded `/api/health`
- Sentry alert or Discord ops ping
- Users can't sign in after deploy
- Cron failure notifications (`video-process-queue`, `vr-daily-report`, `season-sync`, `train-departing-soon`, `eur-tick`)

## Workflow

1. **Health** — Run `npm run ops:health` (set `OPS_BASE_URL` to prod if needed). Read `ok`, `db`, `schema`, `sha`.
2. **Recent errors** — Run `npm run ops:errors` (requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`).
3. **Crons** — Run `npm run ops:crons` (requires `LOCAL_DATABASE_URL` / `DATABASE_URL`). Inspect latest failures.
4. **Correlate deploy** — `git log --oneline -10` and match `sha` from health response.
5. **Runbook** — Follow [docs/ops/triage.md](../../../docs/ops/triage.md) for the matching symptom.
6. **Fix** — Minimal scoped fix on a feature branch / worktree; add regression test if logic bug.
7. **Communicate** — Draft short Discord/email update for platform maintainers (no `game_uid`, JWTs, or emails).

## Privacy

- Never paste Last War `game_uid`, Ashed JWTs, session cookies, or raw emails into alerts or PR comments.
- Sentry issues should only contain routes and stack traces after scrubbing (`src/lib/observability/scrub.ts`).

## Admin UI

- `/admin/ops` — health tile, cron history, ops events, test alert button (platform maintainers only).
