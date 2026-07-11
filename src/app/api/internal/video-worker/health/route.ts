import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unauthenticated liveness for Fly / compose health checks. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "video-worker",
    workerMode: process.env.VIDEO_WORKER_MODE === "1",
  });
}
