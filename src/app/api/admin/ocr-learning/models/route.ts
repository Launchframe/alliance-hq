import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";

export async function GET(request: Request) {
  return withOcrAdmin(async () => {
    const models = await getDb().select({ id: schema.ocrModelVersions.id, scoreTarget: schema.ocrModelVersions.scoreTarget, definition: schema.ocrModelVersions.definition, datasetId: schema.ocrModelVersions.datasetId, trainingJobId: schema.ocrModelVersions.trainingJobId, state: schema.ocrModelVersions.state, createdAt: schema.ocrModelVersions.createdAt }).from(schema.ocrModelVersions).where(eq(schema.ocrModelVersions.allianceId, ocrScope(request))).orderBy(desc(schema.ocrModelVersions.createdAt)).limit(200);
    return NextResponse.json({ models });
  });
}
