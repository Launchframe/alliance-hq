# Video external worker (Phase 2)

Alliance HQ can split **video OCR processing** onto a long-running host while keeping the main Next.js app on Vercel. Phase 1 trims native deps in file tracing; Phase 2 uses env-based dispatch so the Vercel **queue cron** route stays slim.

## Architecture

```mermaid
flowchart LR
  upload[Upload / approve] --> trigger[dispatchVideoProcessing]
  trigger --> jobRoute["POST /api/internal/video-process/:jobId"]
  cron[Vercel Cron queue] --> queueRoute["GET /api/internal/video-process/queue"]
  queueRoute -->|external host| jobRoute
  jobRoute --> pipeline[process-job: ffmpeg + sharp + tesseract]
```

| Surface | Role |
| --- | --- |
| `POST /api/internal/video-process/[jobId]` | Runs the full pipeline (`process-job`). This is the **worker endpoint**. |
| `GET /api/internal/video-process/queue` | Pulls one `queued` job. When external dispatch is on, only **POSTs** to the worker — no local `process-job` import. |
| `scripts/workers/video-processor.mjs` | Optional long-running poller (local dev or Fly/Railway). |

## Environment

| Variable | Purpose |
| --- | --- |
| `VIDEO_WORKER_SECRET` | Bearer token for worker ↔ app (`Authorization: Bearer …`). Required in production. |
| `VIDEO_WORKER_BASE_URL` | Base URL the **app** uses to reach the worker (no trailing slash). |
| `CRON_SECRET` | Vercel Cron auth for the queue route (unchanged). |

### When dispatch stays local (default)

If `VIDEO_WORKER_BASE_URL` is **unset**, or equals the public app origin (`NEXT_PUBLIC_APP_URL` / `VERCEL_URL`), the queue cron processes jobs on the same deployment. Upload triggers still POST to `/api/internal/video-process/[jobId]` on that host.

### When dispatch is external (split deploy)

Set `VIDEO_WORKER_BASE_URL` to a **different host** than the public app, e.g. `https://video-worker.fly.dev`, while `NEXT_PUBLIC_APP_URL` remains `https://frontline.gay`.

- Upload / approve → `dispatchVideoProcessing` POSTs to the worker host.
- Vercel Cron queue → `dispatchVideoJobRemote` POSTs to the same worker host.
- Worker host runs Next (or a minimal Node server) with the `[jobId]` route and full native stack.

Use the **same** `VIDEO_WORKER_SECRET`, database, and R2 credentials on both app and worker.

## Sharp / libvips safety (#213)

Turbopack externalizes `sharp` app-wide. **Global** `outputFileTracingIncludes["*"]` ships libvips on every serverless route — do not remove when trimming OCR bundles. Prefer dynamic `import()` at feature boundaries (THP screenshot OCR) so unrelated routes stay lean.

## Local development

```bash
# Terminal 1 — Next app (default http://localhost:5175)
npm run dev

# Terminal 2 — optional backup poller
VIDEO_WORKER_BASE_URL=http://localhost:5175 VIDEO_WORKER_SECRET=dev-secret \
  node scripts/workers/video-processor.mjs
```

## CI / bundle budgets

`npm run vercel:analyze-function-trace` (linux) enforces uncompressed NFT budgets on OCR routes and `requireLibvips` on Discord/THP routes. Re-run after `npm run build`.

## Related

- `.env.example` — `VIDEO_WORKER_*` comments
- `scripts/vercel/video-ocr-file-tracing.mjs` — shared tracing includes/excludes
- `src/lib/video/video-process-dispatch.server.ts` — external detection + remote dispatch
- `src/lib/video/video-process-local.server.ts` — local `process-job` runner (worker endpoint only when split)
