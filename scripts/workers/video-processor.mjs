#!/usr/bin/env node
/**
 * Poll queued video jobs and POST to the internal processing endpoint.
 * Usage: npm run video:worker
 *
 * Note: uploads also fire-and-forget to the same endpoint on localhost dev,
 * so the worker is a backup poller — it stays quiet when the queue is empty.
 */
import process from "node:process";
import postgres from "postgres";
import dotenv from "dotenv";

import { getDatabaseUrlFromProcessEnv } from "../lib/database-url.mjs";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.development.local" });
}

function resolveWorkerBaseUrl() {
  if (process.env.VIDEO_WORKER_BASE_URL) {
    return process.env.VIDEO_WORKER_BASE_URL;
  }
  const dbUrl = getDatabaseUrlFromProcessEnv();
  if (/localhost|127\.0\.0\.1/.test(dbUrl)) {
    return "http://localhost:5175";
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5175";
}

function formatTimings(timings) {
  if (!timings || typeof timings !== "object") {
    return null;
  }
  const phases = timings.phases ?? {};
  const slowest = Object.entries(phases).sort(([, a], [, b]) => b - a)[0];
  return {
    totalMs: timings.totalMs,
    phases,
    slowestPhase: slowest?.[0] ?? null,
    slowestMs: slowest?.[1] ?? null,
    frameCount: timings.frameCount,
    rowCount: timings.rowCount,
    ocrFrameAvgMs: timings.ocrFrameAvgMs,
  };
}

const POLL_MS = Number(process.env.VIDEO_WORKER_POLL_MS ?? 5000);
const IDLE_LOG_EVERY_MS = Number(
  process.env.VIDEO_WORKER_IDLE_LOG_MS ?? 30_000,
);
const base = resolveWorkerBaseUrl();
const secret = process.env.VIDEO_WORKER_SECRET ?? "dev-secret";
const dbUrl = getDatabaseUrlFromProcessEnv();

if (!dbUrl) {
  console.error("Set LOCAL_DATABASE_URL or DATABASE_URL");
  process.exit(1);
}

const sql = postgres(dbUrl, { prepare: false, max: 2 });
let lastIdleLogAt = 0;

async function poll() {
  const rows = await sql`
    SELECT id, file_name, score_target, created_at
    FROM video_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (rows.length === 0) {
    const now = Date.now();
    if (now - lastIdleLogAt >= IDLE_LOG_EVERY_MS) {
      lastIdleLogAt = now;
      console.log(`… idle (no queued jobs) — polling ${base} every ${POLL_MS}ms`);
    }
    return;
  }

  const job = rows[0];
  const jobId = job.id;
  console.log(
    `[video-worker] pulled job ${jobId} from queue (file=${job.file_name ?? "unknown"}, target=${job.score_target ?? "unknown"}, queuedAt=${job.created_at?.toISOString?.() ?? job.created_at})`,
  );

  const workerStarted = Date.now();

  const processUrl = `${base}/api/internal/video-process/${jobId}`;
  const res = await fetch(processUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "x-video-worker": "1",
    },
  });
  const workerMs = Date.now() - workerStarted;
  const body = await res.text();

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }

  if (!res.ok) {
    console.error(
      `[video-worker] ${jobId} failed (${res.status}) in ${workerMs}ms:`,
      body.slice(0, 200),
    );
    return;
  }

  const summary = formatTimings(payload?.timings);
  console.log(
    `[video-worker] ${jobId} ok in ${workerMs}ms (HTTP round-trip)`,
    summary ? JSON.stringify(summary) : body.slice(0, 200),
  );
}

console.log(`[video-worker] polling ${base} every ${POLL_MS}ms`);

async function loop() {
  try {
    await poll();
  } catch (error) {
    console.error("[video-worker]", error);
  }
  setTimeout(loop, POLL_MS);
}

loop();
