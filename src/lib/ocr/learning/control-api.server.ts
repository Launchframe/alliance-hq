import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { postgresErrorCode } from "@/lib/db/error-message";
import { OcrLearningError, ocrIdSchema } from "../benchmark/types.shared";

export async function withOcrWorker(request: Request, action: () => Promise<Response>): Promise<Response> {
  try {
    const secret = process.env.OCR_WORKER_SECRET;
    if (!secret) throw new OcrLearningError("worker_not_configured", 503);
    const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new OcrLearningError("forbidden", 403);
    const response = await action();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (!(error instanceof OcrLearningError)) console.error("[ocr-worker] operation_failed", { code: postgresErrorCode(error) });
    return NextResponse.json({ ok: false, code: error instanceof OcrLearningError ? error.code : "worker_error" }, { status: error instanceof OcrLearningError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

export function workerLeaseToken(request: Request): string {
  const token = request.headers.get("x-ocr-lease");
  if (!token || !ocrIdSchema.safeParse(token).success) throw new OcrLearningError("worker_lease_required", 403);
  return token;
}
