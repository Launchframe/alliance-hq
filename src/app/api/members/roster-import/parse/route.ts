/**
 * POST /api/members/roster-import/parse
 *
 * Accepts a multipart form upload of a single roster screenshot PNG/JPEG and
 * returns parsed member rows via the native Tesseract.js OCR pipeline.
 *
 * Auth:   requires an active HQ session with members:write permission.
 *         Also enforces "native alliance only" — the session must be connected
 *         to an alliance via HQ credentials (currentAllianceId set).
 *
 * Body:   multipart/form-data
 *   image  File   PNG or JPEG screenshot
 *   layout string (optional) "officers" | "rank_list" — override auto-detect
 *
 * Response 200:
 * {
 *   rows: ParsedRosterRow[],
 *   layout: RosterLayout,
 *   configPassKey?: string,
 *   diagnostics?: { rawLineCount, ignoredLineCount, durationMs }
 * }
 *
 * Error responses: 400, 401, 403, 413, 500
 */

import { NextResponse } from "next/server";

import { getRbacContext } from "@/lib/rbac/context";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { readSessionId } from "@/lib/session";
import { parseRosterImage } from "@/lib/members/roster-ocr/parse-roster-image";
import { assignRosterOcrExperiment } from "@/lib/members/roster-ocr/assign-roster-config";
import type { RosterLayout } from "@/lib/members/roster-ocr/types";

/** Vercel Functions: allow up to 300 s for Tesseract on large images. */
export const maxDuration = 300;
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: Request) {
  // --- Auth ---
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Require members:write permission
  if (!ctx.isPlatformMaintainer && !ctx.permissions.has("members:write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Native alliance only
  if (!ctx.currentAllianceId) {
    return NextResponse.json(
      { error: "A connected HQ alliance is required for roster import." },
      { status: 403 },
    );
  }

  if (!(await isNativeAlliance(ctx.currentAllianceId))) {
    return NextResponse.json(
      { error: "Roster import is only available for native alliances." },
      { status: 403 },
    );
  }

  // --- Parse multipart ---
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

  const layoutParam = formData.get("layout");
  const explicitLayout: RosterLayout | undefined =
    layoutParam === "officers" || layoutParam === "rank_list"
      ? (layoutParam as RosterLayout)
      : undefined;

  // --- Experiment / config assignment ---
  const assignment = await assignRosterOcrExperiment();

  // --- OCR pipeline ---
  try {
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    const result = await parseRosterImage(imageBuffer, {
      layout: explicitLayout,
      config: assignment.config,
      configPassKey: assignment.passKey,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OCR processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
