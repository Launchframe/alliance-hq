# Alliance HQ

A portal shell for [ashed.online](https://ashed.online) — alliance tools for Last War built on the Base44 backend, with custom features like video-to-screenshot upload.

**Production domain:** [alliance-hq.vercel.app](https://alliance-hq.vercel.app)

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

When `NODE_ENV` is not `production`, **`LOCAL_DATABASE_URL` takes precedence** over `DATABASE_URL`, so you can keep a Neon URL in `DATABASE_URL` for deploy previews without touching local dev.

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

**GitHub:** [github.com/amcmillion/alliance-hq](https://github.com/amcmillion/alliance-hq)

```bash
git clone git@github.com:amcmillion/alliance-hq.git
cd alliance-hq
cp .env.example .env.local
npm install
```

## Deploy to Vercel

1. Import [amcmillion/alliance-hq](https://github.com/amcmillion/alliance-hq) in [Vercel](https://vercel.com/new)
2. Set **Production** environment variables (enable for **Production** and **Build** scopes in Vercel):

| Variable | Production value |
|----------|------------------|
| `DATABASE_URL` | Neon Postgres connection string (required at **build** time — migrations run before `next build`) |
| `TOKEN_ENCRYPTION_KEY` | Same 64-char hex key for all environments, or generate once and store in a password manager |
| `NEXT_PUBLIC_APP_URL` | `https://alliance-hq.vercel.app` |

Do **not** set `LOCAL_DATABASE_URL` on Vercel.

3. Deploy — `npm run build` runs `drizzle-kit migrate` automatically, creating/updating tables on Neon.

For local schema changes: `npm run db:generate` → commit new files under `drizzle/` → deploy.

Optional one-off (without redeploying): `DATABASE_URL="postgresql://…neon…" npm run db:migrate`

4. Add custom domain **alliance-hq.vercel.app** in Vercel → Settings → Domains
5. At your DNS provider, point the domain to Vercel (A/CNAME records shown in the Vercel UI)

Health check after deploy: `https://alliance-hq.vercel.app/api/health/db`

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

- [ ] Ingest Ashed DOM captures for pixel-perfect UI parity
- [ ] R2 storage + ffmpeg worker for video frame extraction
- [ ] Wire OCR upload to Ashed via BFF
- [ ] Optional `/admin/debug` entity explorer (from ashed-shell)

## License

Private — alliance use. Ashed / Base44 data terms apply to upstream API usage.
