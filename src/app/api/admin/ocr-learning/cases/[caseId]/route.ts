import { NextResponse } from "next/server";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { confirmCasePair, loadLearningCase, reviseCaseLabels, revokeLearningCase } from "@/lib/ocr/learning/corpus.server";
import { OcrLearningError } from "@/lib/ocr/benchmark/types.shared";

type Context = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrAdmin(async () => {
    const { caseId } = await context.params;
    return NextResponse.json({ sample: await loadLearningCase(ocrScope(request), caseId) });
  });
}

export async function PATCH(request: Request, context: Context) {
  return withOcrAdmin(async (actor) => {
    const { caseId } = await context.params;
    const allianceId = ocrScope(request);
    const { action, ...body } = await readOcrJson(request);
    if (action === "labels") {
      const input = { ...body, allianceId, caseId } as Parameters<typeof reviseCaseLabels>[0];
      return NextResponse.json({ sample: await reviseCaseLabels(input, actor) });
    }
    if (action === "pair") {
      const input = { ...body, allianceId, caseId } as Parameters<typeof confirmCasePair>[0];
      return NextResponse.json({ sample: await confirmCasePair(input, actor) });
    }
    if (action === "revoke" && body.confirmed === true && Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) >= 0) {
      return NextResponse.json({ sample: await revokeLearningCase(allianceId, caseId, Number(body.expectedRevision), actor) });
    }
    throw new OcrLearningError("invalid_action");
  });
}
