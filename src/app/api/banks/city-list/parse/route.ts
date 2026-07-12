/**
 * POST /api/banks/city-list/parse
 *
 * Multipart still-image OCR for the City List → Bank Stronghold tab.
 * Accepts one or more screenshots (`image` / `images` file fields), merges
 * overlapping tiles by server+coordinates, then returns a review payload.
 * Does not write to the database — officers review then confirm via /import.
 */

import { NextResponse } from "next/server";

import { mergeCityListParses } from "@/lib/banks/city-list-ocr/city-list-dedupe.shared";
import { parseCityListImage } from "@/lib/banks/city-list-ocr/parse-city-list-image.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Tesseract on large screenshots can be slow; multi-image adds up. */
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB per image
const MAX_IMAGES = 12;

function collectImageFiles(formData: FormData): File[] {
  const files: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key !== "image" && key !== "images") continue;
    if (value instanceof File && value.size > 0) {
      files.push(value);
    }
  }
  return files;
}

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

  const imageFiles = collectImageFiles(formData);
  if (imageFiles.length === 0) {
    return NextResponse.json(
      { error: "image field is required (File)." },
      { status: 400 },
    );
  }
  if (imageFiles.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_IMAGES} screenshots per import.` },
      { status: 400 },
    );
  }
  for (const imageFile of imageFiles) {
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image must be under 20 MB." },
        { status: 413 },
      );
    }
  }

  try {
    const parts = [];
    for (const imageFile of imageFiles) {
      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      parts.push(await parseCityListImage(imageBuffer));
    }

    const { snapshot, dedupeReport } = mergeCityListParses(parts);

    const warnings: string[] = [];
    if (!snapshot.isComplete && snapshot.capturedCount != null) {
      warnings.push(
        "Imported banks are fewer than the captured count — import will not remove existing banks.",
      );
    }

    const banks = snapshot.banks.map((bank) => ({
      ...bank,
      /** Alias for review/import forms that use deposit-value naming. */
      currentDepositValue: bank.crystalGoldValue,
    }));

    return NextResponse.json({
      snapshot: {
        capturedCount: snapshot.capturedCount,
        capturedLimit: snapshot.capturedLimit,
        capturesRemainingToday: snapshot.capturesRemainingToday,
        capturesLimitToday: snapshot.capturesLimitToday,
        serverTime: snapshot.serverTime,
        isComplete: snapshot.isComplete,
        totalCrystalGoldDeposited: snapshot.totalCrystalGoldDeposited,
      },
      banks,
      warnings,
      dedupeReport,
      imageCount: imageFiles.length,
      /** Per-image OCR lines for officer/admin debugging of empty parses. */
      rawLinesByImage: parts.map((part) => part.rawLines),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OCR processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
