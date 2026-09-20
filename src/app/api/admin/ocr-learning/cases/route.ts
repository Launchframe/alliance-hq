import { NextResponse } from "next/server";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { listLearningCases } from "@/lib/ocr/learning/corpus.server";
import { OcrLearningError, ocrTargetSchema } from "@/lib/ocr/benchmark/types.shared";

export async function GET(request: Request) {
  return withOcrAdmin(async () => {
    const allianceId = ocrScope(request);
    const target = new URL(request.url).searchParams.get("scoreTarget");
    const parsed = ocrTargetSchema.optional().safeParse(target ?? undefined);
    if (!parsed.success) throw new OcrLearningError("invalid_target");
    return NextResponse.json({ cases: await listLearningCases(allianceId, parsed.data) });
  });
}
