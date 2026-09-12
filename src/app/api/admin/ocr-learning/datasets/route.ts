import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { freezeDataset } from "@/lib/ocr/learning/corpus.server";

export async function GET(request: Request) {
  return withOcrAdmin(async () => {
    const datasets = await getDb().select({ id: schema.ocrDatasetVersions.id, manifestHash: schema.ocrDatasetVersions.manifestHash, createdAt: schema.ocrDatasetVersions.createdAt })
      .from(schema.ocrDatasetVersions).where(eq(schema.ocrDatasetVersions.allianceId, ocrScope(request))).orderBy(desc(schema.ocrDatasetVersions.createdAt)).limit(200);
    return NextResponse.json({ datasets });
  });
}

export async function POST(request: Request) {
  return withOcrAdmin(async (actor) => {
    const body = await readOcrJson(request);
    const dataset = await freezeDataset(body as Parameters<typeof freezeDataset>[0], actor);
    return NextResponse.json({ id: dataset.id, manifestHash: dataset.manifestHash, caseCount: dataset.manifest.entries.length }, { status: 201 });
  });
}
