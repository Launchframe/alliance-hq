import { NextResponse } from "next/server";

import { videoProcessJobToResponse } from "@/lib/video/video-process-dispatch.server";
import { runVideoProcessJobLocally } from "@/lib/video/video-process-local.server";

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

  const result = await runVideoProcessJobLocally(jobId, { analyticsSource });
  if (result.code === "ashed_not_connected") {
    return NextResponse.json(
      {
        ok: false,
        jobId,
        status: "pending_approval",
        code: "ashed_not_connected",
      },
      { status: 409 },
    );
  }
  return videoProcessJobToResponse(result);
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
