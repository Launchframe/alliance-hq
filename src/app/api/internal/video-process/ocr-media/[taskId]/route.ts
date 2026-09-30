import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OcrLearningError, ocrIdSchema } from "@/lib/ocr/benchmark/types.shared";
import { processMediaTask } from "@/lib/ocr/learning/media-worker.server";

export const runtime = "nodejs";
export const maxDuration = 300;

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  const secret = process.env.OCR_WORKER_SECRET;
  if (!secret) return NextResponse.json({ code: "worker_not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try {
    const { taskId } = await context.params;
    if (!ocrIdSchema.safeParse(taskId).success) throw new OcrLearningError("invalid_request");
    return NextResponse.json({ caseId: await processMediaTask(taskId) });
  } catch (error) {
    return NextResponse.json({ code: error instanceof OcrLearningError ? error.code : "media_processing_failed" }, { status: error instanceof OcrLearningError ? error.status : 500 });
  }
}
