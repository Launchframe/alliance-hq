import "server-only";

import { NextResponse } from "next/server";

import { resolveAppOrigin } from "@/lib/app-origin";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";

export type VideoProcessJobResult = {
  ok: boolean;
  processed: boolean;
  jobId: string;
  status: string;
  timings?: VideoProcessTimings;
  code?: string;
  error?: string;
  httpStatus: number;
};

/** Trimmed worker base URL from VIDEO_WORKER_BASE_URL, if set. */
export function externalVideoWorkerBaseUrl(): string | null {
  const raw = process.env.VIDEO_WORKER_BASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

/** Worker base URL when VIDEO_WORKER_BASE_URL is set; otherwise the public app origin. */
export function resolveVideoProcessBaseUrl(): string {
  return externalVideoWorkerBaseUrl() ?? resolveAppOrigin();
}

/**
 * When true, this runtime should not import the heavy process-job graph — queue
 * cron and similar entry points POST to VIDEO_WORKER_BASE_URL instead.
 *
 * Same host as the public app (default) still processes locally for backward
 * compatibility. Point VIDEO_WORKER_BASE_URL at a dedicated worker host for
 * Phase 2 split deploys.
 */
export function videoQueueDispatchesExternally(): boolean {
  const worker = externalVideoWorkerBaseUrl();
  if (!worker) {
    return false;
  }
  return worker !== resolveAppOrigin();
}

export function resolveVideoProcessEndpoint(jobId: string): string {
  return `${resolveVideoProcessBaseUrl()}/api/internal/video-process/${jobId}`;
}

export async function dispatchVideoJobRemote(
  jobId: string,
  options?: { source?: string },
): Promise<VideoProcessJobResult> {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) {
    return {
      ok: false,
      processed: false,
      jobId,
      status: "failed",
      error: "VIDEO_WORKER_SECRET is not configured.",
      httpStatus: 503,
    };
  }

  const source = options?.source ?? "queue";
  let res: Response;
  try {
    res = await fetch(resolveVideoProcessEndpoint(jobId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-video-worker": source === "upload" ? "0" : "1",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Worker dispatch failed";
    return {
      ok: false,
      processed: false,
      jobId,
      status: "failed",
      error: message,
      httpStatus: 502,
    };
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  return {
    ok: Boolean(payload?.ok ?? res.ok),
    processed: Boolean(payload?.processed),
    jobId,
    status: typeof payload?.status === "string" ? payload.status : "failed",
    timings: payload?.timings as VideoProcessTimings | undefined,
    code: typeof payload?.code === "string" ? payload.code : undefined,
    error: typeof payload?.error === "string" ? payload.error : undefined,
    httpStatus: res.status,
  };
}

export function videoProcessJobToResponse(result: VideoProcessJobResult): NextResponse {
  const body = {
    ok: result.ok,
    processed: result.processed,
    jobId: result.jobId,
    status: result.status,
    ...(result.timings ? { timings: result.timings } : {}),
    ...(result.code ? { code: result.code } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
  return NextResponse.json(body, { status: result.httpStatus });
}
