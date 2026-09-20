import { NextResponse } from "next/server";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { loadUsableDataset } from "@/lib/ocr/learning/corpus.server";

type Context = { params: Promise<{ datasetId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrAdmin(async () => {
    const { datasetId } = await context.params;
    return NextResponse.json({ dataset: await loadUsableDataset(ocrScope(request), datasetId) });
  });
}
