import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";
import {
  buildOcrDiagnostics,
  type OcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import {
  downscaleScreenshotPreview,
  extractBandPreview,
  extractModalPreview,
} from "@/lib/ocr/screenshot-preview.shared";
import type { ScreenshotOcrBboxOverlay } from "@/lib/ocr/screenshot-ocr-geometry.shared";
import type { ScreenshotOcrQualityMetrics } from "@/lib/ocr/screenshot-ocr-quality.shared";
import {
  putObject,
  screenshotOcrArtifactsPrefix,
  screenshotOcrPreviewKey,
} from "@/lib/storage";
import type { ParsePowerDetailsImageResult } from "@/lib/thp/hero-power-ocr/parse-power-details-image";

export type RecordScreenshotOcrJobInput = {
  source: string;
  screenshotBuffer: Buffer;
  allianceId?: string | null;
  hqUserId?: string | null;
  discordUserId?: string | null;
  ocr: ParsePowerDetailsImageResult;
  jobId?: string;
};

type BandCrops = {
  labelCrop: CropRect;
  valueCrop: CropRect;
  headerCrop: CropRect;
};

async function readSourceDimensions(
  screenshotBuffer: Buffer,
): Promise<{ width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(screenshotBuffer).metadata();
  return {
    width: meta.width ?? 1080,
    height: meta.height ?? 1920,
  };
}

function buildDiagnosticsJson(
  jobId: string,
  ocr: ParsePowerDetailsImageResult,
): OcrDiagnostics & {
  quality?: ScreenshotOcrQualityMetrics;
  bboxOverlays?: ScreenshotOcrBboxOverlay[];
  cropCandidates?: ScreenshotOcrQualityMetrics["cropCandidateScores"];
  phaseTimings?: ScreenshotOcrQualityMetrics["phaseTimings"];
  pairedRows?: Array<{
    key: string | null;
    label: string;
    value: number | null;
    valueText: string;
  }>;
} {
  const quality = ocr.diagnostics.quality;
  return {
    ...buildOcrDiagnostics({
      source: "thp_screenshot",
      durationMs: ocr.diagnostics.durationMs,
      rawLineCount: ocr.diagnostics.rawLineCount,
      lines: ocr.diagnostics.sampleLines,
      parsedOk: quality?.parsedOk ?? (ocr.complete && ocr.heroPowerTotal != null),
      parsedValue: ocr.heroPowerTotal,
      entryCount: ocr.diagnostics.pairedCount,
      jobId,
      modalRect: ocr.diagnostics.modalRect ?? null,
      modalMethod: ocr.diagnostics.modalMethod ?? null,
      failureCodes: quality?.failureCodes,
      qualityParsedOk: quality?.parsedOk,
      qualityComplete: quality?.complete,
    }),
    quality,
    bboxOverlays: ocr.diagnostics.bboxOverlays,
    cropCandidates: ocr.diagnostics.cropCandidates,
    phaseTimings: ocr.diagnostics.phaseTimings,
    pairedRows: Object.entries(ocr.breakdown).map(([key, value]) => ({
      key,
      label: key,
      value,
      valueText: value != null ? String(value) : "",
    })),
  };
}

async function uploadScreenshotOcrArtifacts(input: {
  jobId: string;
  screenshotBuffer: Buffer;
  modalRect: CropRect;
  bandCrops: BandCrops;
  diagnosticsJson: Record<string, unknown>;
}): Promise<void> {
  const [fullPreview, modalPreview, labelPreview, valuePreview] =
    await Promise.all([
      downscaleScreenshotPreview(input.screenshotBuffer),
      extractModalPreview(input.screenshotBuffer, input.modalRect),
      extractBandPreview(input.screenshotBuffer, input.bandCrops.labelCrop),
      extractBandPreview(input.screenshotBuffer, input.bandCrops.valueCrop),
    ]);

  const cropCandidates = {
    modalRect: input.modalRect,
    labelBand: input.bandCrops.labelCrop,
    valueBand: input.bandCrops.valueCrop,
    diagnostics: input.diagnosticsJson,
  };

  await Promise.all([
    putObject(
      screenshotOcrPreviewKey(input.jobId, "preview-full"),
      fullPreview.buffer,
    ),
    putObject(
      screenshotOcrPreviewKey(input.jobId, "preview-modal"),
      modalPreview,
    ),
    putObject(
      screenshotOcrPreviewKey(input.jobId, "preview-label-band"),
      labelPreview,
    ),
    putObject(
      screenshotOcrPreviewKey(input.jobId, "preview-value-band"),
      valuePreview,
    ),
    putObject(
      screenshotOcrPreviewKey(input.jobId, "diagnostics"),
      Buffer.from(JSON.stringify(input.diagnosticsJson)),
    ),
    putObject(
      screenshotOcrPreviewKey(input.jobId, "crop-candidates"),
      Buffer.from(JSON.stringify(cropCandidates)),
    ),
  ]);
}

export async function recordScreenshotOcrJob(
  input: RecordScreenshotOcrJobInput,
): Promise<string> {
  const jobId = input.jobId ?? nanoid(16);
  const { width: sourceWidth, height: sourceHeight } = await readSourceDimensions(
    input.screenshotBuffer,
  );
  const modalRect = input.ocr.diagnostics.modalRect;
  const bandCrops = input.ocr.diagnostics.bandCrops;
  const quality = input.ocr.diagnostics.quality;

  if (!modalRect || !bandCrops || !quality) {
    throw new Error("recordScreenshotOcrJob requires modal diagnostics from parse");
  }

  const diagnosticsJson = buildDiagnosticsJson(jobId, input.ocr);
  const artifactsPrefix = screenshotOcrArtifactsPrefix(jobId);
  const db = getDb();

  await db.insert(schema.screenshotOcrJobs).values({
    id: jobId,
    source: input.source,
    allianceId: input.allianceId ?? null,
    hqUserId: input.hqUserId ?? null,
    discordUserId: input.discordUserId ?? null,
    sourceWidth,
    sourceHeight,
    modalRectJson: modalRect,
    modalMethod: input.ocr.diagnostics.modalMethod ?? null,
    parsedOk: quality.parsedOk ? 1 : 0,
    parsedValue: input.ocr.heroPowerTotal,
    entryCount: input.ocr.diagnostics.pairedCount ?? null,
    complete: input.ocr.complete ? 1 : 0,
    qualityJson: quality,
    diagnosticsJson,
    artifactsPrefix,
    createdAt: new Date(),
  });

  void uploadScreenshotOcrArtifacts({
    jobId,
    screenshotBuffer: input.screenshotBuffer,
    modalRect,
    bandCrops,
    diagnosticsJson,
  }).catch((error: unknown) => {
    console.error("[screenshot-ocr-job] artifact upload failed", jobId, error);
  });

  return jobId;
}

export async function updateScreenshotOcrJobUserOutcome(
  jobId: string,
  confirmed: boolean,
  reason?: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ qualityJson: schema.screenshotOcrJobs.qualityJson })
    .from(schema.screenshotOcrJobs)
    .where(eq(schema.screenshotOcrJobs.id, jobId))
    .limit(1);

  if (!row) return;

  const quality = (row.qualityJson ?? {}) as ScreenshotOcrQualityMetrics;
  const failureCodes = new Set(quality.failureCodes ?? []);
  if (!confirmed) {
    failureCodes.add("user_rejected");
  }

  const updated: ScreenshotOcrQualityMetrics = {
    ...quality,
    userConfirmed: confirmed,
    userRejectedReason: confirmed ? null : (reason ?? null),
    failureCodes: [...failureCodes],
  };

  await db
    .update(schema.screenshotOcrJobs)
    .set({ qualityJson: updated })
    .where(eq(schema.screenshotOcrJobs.id, jobId));
}
