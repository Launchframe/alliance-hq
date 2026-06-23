# Alliance HQ

A portal shell for [ashed.online](https://ashed.online) — alliance tools for Last War built on the Base44 backend, with custom features like video-to-screenshot upload.

**Production domain:** [frontline.gay](https://frontline.gay)

## What this is

- **Ashed-matched shell UI** with sidebar navigation
- **Connect Ashed** walkthrough — paste your Base44 token; we store it encrypted server-side
- **BFF layer** — browser never holds the Ashed JWT after connect
- **Video upload (POC)** — queue screen recordings for frame extraction → Ashed OCR (worker wiring next)

All core alliance data and OCR remain on [Ashed](https://ashed.online). Alliance HQ adds convenience tools the main app does not ship yet.

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind 4
- Postgres + Drizzle ORM
- [@base44/sdk](https://docs.base44.com) (same backend as ashed.online)
- Deploy target: Vercel + Neon Postgres

Ported from the [`ashed-shell`](~/workspace/ashed-shell) spike: connection string parsing, walkthrough UX, Base44 app id.

## Local setup

```bash
cd ~/workspace/alliance-hq
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | How to get it |
|----------|----------------|
| `LOCAL_DATABASE_URL` | Local Postgres, e.g. `postgresql://postgres:yourpassword@localhost:5432/alliance_hq_dev` — **no** `?schema=public` |
| `DATABASE_URL` | Optional locally; required on Vercel / Neon for production |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:5175` for local dev |
| `AUTH_SECRET` | `openssl rand -base64 32` — required for magic-link auth |
| `RESEND_API_KEY` / `EMAIL_FROM` | See [docs/deploy-frontline-gay.md](./docs/deploy-frontline-gay.md) |

When **`LOCAL_DATABASE_URL` is set**, it wins over `DATABASE_URL` on your machine — including `next start` and `vercel dev`. The only exception is **Vercel production** (`VERCEL=1` + `NODE_ENV=production`), where `DATABASE_URL` is always used.

If you ran `vercel env pull`, Neon lands in `.env.development.local` alongside your local URL — that is fine; local Postgres is still selected. Do **not** set `LOCAL_DATABASE_URL` on Vercel.

To run migrations against Neon from your laptop: unset `LOCAL_DATABASE_URL` for that command (e.g. `LOCAL_DATABASE_URL= DATABASE_URL="postgresql://…" npm run db:migrate`).

Create the local database if needed:

```bash
createdb alliance_hq   # or via psql
```

```bash
npm install
npm run db:push    # create tables (uses LOCAL_DATABASE_URL locally)
npm run dev        # http://localhost:5175
```

`db:push` printing **No changes detected** means your schema is already applied — that is normal, not a failure.

Verify DB wiring: [http://localhost:5175/api/health/db](http://localhost:5175/api/health/db) should return `{"ok":true,...}`.

Open [http://localhost:5175](http://localhost:5175) → follow **Connect Ashed** walkthrough.

## Connect Ashed

1. Log into [ashed.online](https://ashed.online)
2. DevTools → **Network** → click any `base44.app` request
3. **Right-click → Copy → Copy as cURL** (Chrome, Firefox, Edge, Brave, Safari)
4. Paste into Alliance HQ connect wizard — we extract your token automatically

Also accepted: raw JWT, `Bearer …`, `authorization:` header line, or `base44://…` connection string.

## Repository

**GitHub:** [github.com/Launchframe/alliance-hq](https://github.com/Launchframe/alliance-hq)

```bash
git clone git@github.com:Launchframe/alliance-hq.git
cd alliance-hq
cp .env.example .env.local
npm install
```

## Deploy to Vercel

1. Import [Launchframe/alliance-hq](https://github.com/Launchframe/alliance-hq) in [Vercel](https://vercel.com/new)
2. Set **Production** environment variables (enable for **Production** and **Build** scopes in Vercel):

| Variable | Production value |
|----------|------------------|
| `DATABASE_URL` | Neon Postgres connection string (required at **build** time — migrations run before `next build`) |
| `TOKEN_ENCRYPTION_KEY` | Same 64-char hex key for all environments, or generate once and store in a password manager |
| `NEXT_PUBLIC_APP_URL` | `https://frontline.gay` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `RESEND_API_KEY` | Resend API key (production sends from `@frontline.gay`) |
| `EMAIL_FROM` | `Alliance HQ <auth@frontline.gay>` |
| `VIDEO_WORKER_SECRET` | Random secret (same value if you run the optional backup worker) |
| `PLATFORM_BOOTSTRAP_EMAIL` | Your Ashed email — auto-promoted to platform maintainer on first connect when none exist |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | Bucket name for uploaded videos and frames |

Do **not** set `LOCAL_DATABASE_URL` on Vercel.

3. Deploy — `npm run build` runs migrations and idempotent DB seeds automatically before `next build` (requires `DATABASE_URL` at build time).

For local schema changes: `npm run db:generate` → commit new files under `drizzle/` → deploy. After `db:push` locally, run `npm run db:seed` once if you have not run a full build.

Optional one-off (without redeploying): `DATABASE_URL="postgresql://…neon…" npm run db:prepare`

4. Add custom domain **`frontline.gay`** in Vercel → Settings → Domains (see [docs/deploy-frontline-gay.md](./docs/deploy-frontline-gay.md) for DNS + Resend checklist)
5. At your DNS provider, point the domain to Vercel (records shown in the Vercel UI)

Health check after deploy: `https://frontline.gay/api/health/db`

## Ashed API catalog

Place HAR captures in `har/` (gitignored — they contain JWTs). Record one file per Ashed nav group while browsing [ashed.online](https://ashed.online):

```
har/
  ashed.online-alliance_management.har
  ashed.online-performance_and_reporting.har
  ashed.online-events_and_operations.har
  ashed.online-admin_and_settings.har
  ashed.online-profile.har
```

Regenerate the committed, sanitized catalog:

```bash
npm run har:catalog
```

Output: [`docs/ashed-api-catalog.json`](docs/ashed-api-catalog.json) — entities, functions, nav groups, and RBAC matrix (no auth headers or bodies).

Related design docs:

- [`docs/multi-tenant-schema.md`](docs/multi-tenant-schema.md) — alliances, HQ users, roles, alliance-scoped tokens
- [`docs/bff-spec.md`](docs/bff-spec.md) — BFF route layout and deny-by-default proxy rules
- [`docs/rbac-matrix.md`](docs/rbac-matrix.md) — permission and role template summary

## Video upload (Phase 1)

Upload a Desert Storm leaderboard scroll-recording at **Tools → Upload from video**. The pipeline:

1. Stores video in **Cloudflare R2** on Vercel (or `.data/uploads/` locally when R2 is unset)
2. Extracts frames with **ffmpeg** (`ffmpeg-static` on Vercel; `brew install ffmpeg` for local dev)
3. OCRs each frame via Base44 `UploadFile` + `ExtractDataFromUploadedFile` (BFF proxy)
4. Fuzzy-matches names against Ashed `Member` list
5. Review UI → submit to `DesertStormScore/bulk`

**Requirements for local dev:**

```bash
brew install ffmpeg   # macOS
```

Add to `.env.local`:

```
VIDEO_WORKER_SECRET=dev-secret
```

After `npm run dev`, either:

- Processing starts automatically after upload (fire-and-forget to `/api/internal/video-process/{jobId}` on **localhost**), or
- Run a poller in another terminal: `npm run video:worker` (auto-targets localhost when `LOCAL_DATABASE_URL` is local — do not point at Vercel; ffmpeg and uploads live on your machine)

Open **Review** on a job when status is `ready to review`. Pick event, team, date, fix matches, then **Save scores**.

**Production (Vercel):** With R2 env vars set, uploads land in R2. Processing is triggered via `waitUntil` after upload (`/api/internal/video-process/{jobId}`). A **Vercel Cron** (`/api/internal/video-process/queue`, every minute) drains any job still `queued` if the trigger was dropped. Set `CRON_SECRET` in Vercel (Cron sends `Authorization: Bearer $CRON_SECRET`). Optionally run `npm run video:worker` locally as another backup poller.

**Timing / bottlenecks:** Each run logs phase timings to stdout (`[video-pipeline]` summary and `[video-pipeline] step` per hop). On Vercel production, custom events go to **Web Analytics** (`Video Pipeline Phase`, `Video Pipeline Complete`, etc.). Ashed frame uploads run in parallel — set `VIDEO_ASHED_FRAME_CONCURRENCY` (default 4, max 8). Compare `ashed.ocr_total` wall time vs summed `ashed.upload`/`ashed.extract` phases to see parallel speedup.

## Project structure

```
src/
  app/
    (app)/          # Authenticated shell (requires Ashed connection)
    connect/        # Connection walkthrough
    api/
      auth/         # connect, disconnect, session
      tools/        # video upload
  components/
    ashed-shell/    # Layout chrome
    ConnectionWalkthrough.tsx
  lib/
    connectionString.ts   # ported from ashed-shell
    base44/server.ts
    session/              # httpOnly cookie + encrypted credentials
    db/
```

## Roadmap

- [x] Phase 1 video parser — Desert Storm upload → OCR → review → Ashed bulk submit
- [ ] Phase 2 Admin Portal
- [ ] Phase 3 Alliance Star, Frontline Breakthrough, remaining score targets
- [x] R2 storage for production video pipeline
- [ ] Adaptive scroll profile learning

## License

Private — alliance use. Ashed / Base44 data terms apply to upstream API usage.
