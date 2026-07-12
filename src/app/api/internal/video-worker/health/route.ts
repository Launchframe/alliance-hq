import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unauthenticated liveness for Fly / compose health checks. */
export async function GET() {
  if (process.env.VIDEO_WORKER_MODE !== "1") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    service: "video-worker",
    workerMode: true,
  });
}
