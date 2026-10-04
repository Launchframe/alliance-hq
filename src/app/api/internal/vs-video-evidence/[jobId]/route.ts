import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { processVsVideoEvidence } from "@/lib/vs-performance/video-evidence-process.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): "ok" | "missing_secret" | "denied" {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) return "missing_secret";
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? "ok"
    : "denied";
}

type Props = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Props) {
  const auth = authorize(request);
  if (auth === "missing_secret") {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (auth !== "ok") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { jobId } = await params;
  await processVsVideoEvidence(jobId);
  return NextResponse.json({ ok: true });
}
