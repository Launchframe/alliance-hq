import { NextResponse } from "next/server";

import { processVideoJob } from "@/lib/video/process-job";

export const maxDuration = 300;
export const runtime = "nodejs";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "VIDEO_WORKER_SECRET is not configured." },
      { status: 503 },
    );
  }

  const authHeader = _request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { jobId } = await params;
  const analyticsSource =
    _request.headers.get("x-video-worker") === "1" ? "worker" : "api";

  try {
    const timings = await processVideoJob(jobId, { analyticsSource });
    return NextResponse.json({ ok: true, jobId, status: "review", timings });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Processing failed",
      },
      { status: 500 },
    );
  }
}

/** Allow same handler for fire-and-forget from upload route without auth in local dev */
export async function GET(request: Request, { params }: Props) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { jobId } = await params;
  const secret = process.env.VIDEO_WORKER_SECRET ?? "dev-secret";
  const req = new Request(request.url, {
    headers: { authorization: `Bearer ${secret}` },
  });
  return POST(req, { params: Promise.resolve({ jobId }) });
}
