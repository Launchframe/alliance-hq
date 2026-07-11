# Video worker (Phase 2b) — ops

Long-running Next.js host for fat video OCR routes. Public HQ stays on Vercel.

## Local smoke

```bash
# Terminal A — worker (port 5176)
npm run video:worker:docker
# or: docker compose -f deploy/video-worker/docker-compose.yml up --build

curl -s http://localhost:5176/api/internal/video-worker/health

# Terminal B — app
VIDEO_WORKER_BASE_URL=http://localhost:5176 VIDEO_WORKER_SECRET=dev-secret npm run dev
```

## Fly deploy (from repo root)

```bash
fly apps create alliance-hq-video-worker   # once
fly secrets set -a alliance-hq-video-worker \
  VIDEO_WORKER_SECRET=… \
  VIDEO_WORKER_BASE_URL=https://alliance-hq-video-worker.fly.dev \
  NEXT_PUBLIC_APP_URL=https://frontline.gay \
  DATABASE_URL=… \
  TOKEN_ENCRYPTION_KEY=… \
  AUTH_SECRET=… \
  R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…

# Build context MUST be the repo root (Dockerfile COPY paths).
fly deploy \
  --config deploy/video-worker/fly.toml \
  --dockerfile deploy/video-worker/Dockerfile \
  --ha=false
```

Then set Vercel `VIDEO_WORKER_BASE_URL` to the Fly URL (same secret).

See `docs/guides/video-external-worker.md` for the full env matrix.
