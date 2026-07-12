/**
 * POST /api/banks/city-list/parse
 *
 * Multipart still-image OCR for the City List → Bank Stronghold tab.
 * Does not write to the database — officers review then confirm via /import.
 */

import { NextResponse } from "next/server";

import { parseCityListImage } from "@/lib/banks/city-list-ocr/parse-city-list-image.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Tesseract on large screenshots can be slow. */
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: Request) {
  const context = await requireBankAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const denied = await requireBankWrite(context.sessionId);
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const imageFile = formData.get("image");
  if (!(imageFile instanceof File)) {
    return NextResponse.json(
      { error: "image field is required (File)." },
      { status: 400 },
    );
  }

  if (imageFile.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Image must be under 20 MB." },
      { status: 413 },
    );
  }

  try {
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const result = await parseCityListImage(imageBuffer);

    const warnings: string[] = [];
    if (!result.isComplete && result.capturedCount != null) {
      warnings.push(
        "Screenshot shows fewer banks than the captured count — import will not remove existing banks.",
      );
    }

    const snapshot = {
      capturedCount: result.capturedCount,
      capturedLimit: result.capturedLimit,
      capturesRemainingToday: result.capturesRemainingToday,
      capturesLimitToday: result.capturesLimitToday,
      serverTime: result.serverTime,
      isComplete: result.isComplete,
      totalCrystalGoldDeposited: result.totalCrystalGoldDeposited,
    };

    const banks = result.banks.map((bank) => ({
      ...bank,
      /** Alias for review/import forms that use deposit-value naming. */
      currentDepositValue: bank.crystalGoldValue,
    }));

    return NextResponse.json({
      snapshot,
      banks,
      warnings,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OCR processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
