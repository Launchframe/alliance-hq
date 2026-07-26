# Alliance HQ ops triage runbook

Quick paths for production incidents. Pair with `npm run ops:health`, `npm run ops:errors`, and `npm run ops:crons`.

## Users can't sign in / stuck on auth

**Symptoms:** Valid session but app redirects to `/auth`, or pages show server error after deploy.

1. Run `npm run ops:health` against production (`OPS_BASE_URL=https://frontline.gay`).
2. If `schema: false` or `column … does not exist` in Sentry → **schema drift**: code deployed before `db:prepare` / journaled migrations applied. Fix: ensure `drizzle/meta/_journal.json` includes the migration and redeploy so `db:prepare` runs.
3. Check Sentry for auth / session 500s (`cause: schema_drift` tag from `withApiErrorHandler`).
4. Confirm `global-error` / locale `error.tsx` show retry UI (not a forced sign-out).

## Cron failure

**Symptoms:** Discord/email alert `Cron failed: <name>`, or `/admin/ops` shows a failed cron row.

1. `npm run ops:crons -- --name=season-sync` (or failing job name).
2. Read `error_class` / `error_message` in admin ops or Sentry (`cron` tag).
3. Re-run manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://frontline.gay/api/internal/season-sync
```

(Paths: `video-process/queue`, `vr/daily-report`, `season-sync`, `train/departing-soon`, `cron/eur-tick`.)

4. For video queue — also check `VIDEO_WORKER_SECRET` / `VIDEO_WORKER_BASE_URL` and worker host health.
5. **`degraded` status** (no alert): `vr-daily-report` returns HTTP 503 when no Discord report channel is configured — expected until an owner runs `/set-vr-report-channel`. Other cron HTTP ≥500 responses (e.g. video worker 502) **do** alert and record `failure`.

## 5xx spike

1. Sentry → sort by frequency last 1h.
2. `git log --since="2 hours ago" --oneline` on deployed SHA (`VERCEL_GIT_COMMIT_SHA` in `/api/health`).
3. Roll back deploy or hotfix; verify `/api/health` returns 200.

## Discord / email delivery failure

1. `/admin/ops` → **Send test alert**.
2. Verify env: `DISCORD_OPS_WEBHOOK_URL`, `RESEND_API_KEY`, platform maintainer emails on `hq_users`.
3. Check `ops_events.channel_status` JSON — which channel returned false.
4. Email uses `emailPlatformMaintainers` (Resend); Discord uses the ops webhook only (no Telegram).

## Better Stack / UptimeRobot setup (free tier)

1. Create uptime monitor: `GET https://frontline.gay/api/health` every few minutes.
2. On down → webhook to `POST https://frontline.gay/api/alerts/incoming` with header `Authorization: Bearer $OPS_ALERTS_INCOMING_SECRET` and JSON body `{ "source": "betterstack", "severity": "page", "title": "Health check failed", "body": "..." }`.

## Sentry alert rules

1. **New issue in production** → webhook to `/api/alerts/incoming` (same bearer secret).
2. **Issue spike** → same endpoint with `severity: page`.

## Future: GlitchTip

If Sentry free-tier quota is exceeded, self-hosted GlitchTip is a documented option — swap DSNs and keep the same scrubber + incoming webhook contract.

## Agent-assisted triage

Use the Cursor **triage** skill (`.cursor/skills/triage/SKILL.md`): pull recent Sentry issues, correlate commits, propose minimal fix branch, draft Discord update.
