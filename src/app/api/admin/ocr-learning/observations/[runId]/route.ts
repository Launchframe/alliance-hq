import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { ocrContentHash } from "@/lib/ocr/learning/recording.server";
import { OcrLearningError } from "@/lib/ocr/benchmark/types.shared";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrAdmin(async () => {
    const allianceId = ocrScope(request), { runId } = await context.params;
    const [run] = await getDb().select().from(schema.ocrPipelineRuns).where(and(eq(schema.ocrPipelineRuns.id, runId), eq(schema.ocrPipelineRuns.allianceId, allianceId))).limit(1);
    if (!run) throw new OcrLearningError("run_not_found", 404);
    if (ocrContentHash(run.manifest) !== run.manifestHash) throw new OcrLearningError("corrupt_run", 409);
    const feedback = await getDb().select().from(schema.ocrFeedbackEvents).where(and(eq(schema.ocrFeedbackEvents.runId, runId), eq(schema.ocrFeedbackEvents.allianceId, allianceId))).orderBy(desc(schema.ocrFeedbackEvents.createdAt)).limit(200);
    return NextResponse.json({ run, feedback });
  });
}
