import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";

export async function GET(request: Request) {
  return withOcrAdmin(async () => {
    const runs = await getDb().select({
      id: schema.ocrPipelineRuns.id, jobId: schema.ocrPipelineRuns.jobId, scoreTarget: schema.ocrPipelineRuns.scoreTarget,
      engine: schema.ocrPipelineRuns.engine, synthetic: schema.ocrPipelineRuns.synthetic, createdAt: schema.ocrPipelineRuns.createdAt,
      sourceSha256: schema.ocrPipelineRuns.sourceSha256, manifestHash: schema.ocrPipelineRuns.manifestHash,
      frameCount: sql<number>`jsonb_array_length(${schema.ocrPipelineRuns.manifest}->'frames')`,
      observationCount: sql<number>`jsonb_array_length(${schema.ocrPipelineRuns.manifest}->'observations')`,
    }).from(schema.ocrPipelineRuns).where(eq(schema.ocrPipelineRuns.allianceId, ocrScope(request))).orderBy(desc(schema.ocrPipelineRuns.createdAt)).limit(200);
    return NextResponse.json({ runs });
  });
}
