import "server-only";

import { and, count, desc, eq, type SQL } from "drizzle-orm";

import { isoOrNull } from "@/lib/admin/feedback-reports";
import {
  type ScreenshotOcrJobDetailReport,
  type ScreenshotOcrJobListItem,
  type ScreenshotOcrJobsListQuery,
  type ScreenshotOcrPairedRow,
  screenshotOcrJobPreviewHref,
  type ScreenshotOcrJobSource,
  type ScreenshotPreviewKind,
} from "@/lib/admin/screenshot-ocr-jobs.shared";
import { getDb, schema } from "@/lib/db";
import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";
import {
  assignOverlayIndices,
  modalRectToBbox,
  type ScreenshotOcrBboxOverlay,
} from "@/lib/ocr/screenshot-ocr-geometry.shared";
import type { ScreenshotOcrQualityMetrics } from "@/lib/ocr/screenshot-ocr-quality.shared";
import {
  screenshotOcrPreviewKey,
  type ScreenshotOcrPreviewKind as StoragePreviewKind,
} from "@/lib/storage";

const API_TO_STORAGE_PREVIEW_KIND: Record<
  ScreenshotPreviewKind,
  StoragePreviewKind
> = {
  full: "preview-full",
  modal: "preview-modal",
  "label-band": "preview-label-band",
  "value-band": "preview-value-band",
};

function readQuality(value: unknown): ScreenshotOcrQualityMetrics | null {
  if (!value || typeof value !== "object") return null;
  return value as ScreenshotOcrQualityMetrics;
}

function readOverlays(value: unknown): ScreenshotOcrBboxOverlay[] {
  if (!Array.isArray(value)) return [];
  return value as ScreenshotOcrBboxOverlay[];
}

function readPairedRows(value: unknown): ScreenshotOcrPairedRow[] {
  if (!Array.isArray(value)) return [];
  return value as ScreenshotOcrPairedRow[];
}

function readDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function defaultQuality(
  row: typeof schema.screenshotOcrJobs.$inferSelect,
): ScreenshotOcrQualityMetrics {
  return {
    parsedOk: Boolean(row.parsedOk),
    complete: Boolean(row.complete),
    failureCodes: [],
    pairedCount: row.entryCount ?? 0,
    expectedPairCount: 7,
    unmatchedValueLineCount: 0,
    maxZipYNormDistance: 0,
    headerToHeroLevelRatio: null,
    headerTotal: row.parsedValue,
    componentSum: null,
    sumDelta: null,
    headerSource: null,
    layoutClass: "unknown",
    aspectRatio: row.sourceWidth / Math.max(1, row.sourceHeight),
    modalAreaFraction: null,
    modalDetectConfidence: null,
    modalMethod: row.modalMethod,
    cropCandidateScores: [],
    rawLineCount: 0,
    labelLineCount: 0,
    valueLineCount: 0,
    invertedValueLineCount: 0,
    headerLineCount: 0,
    phaseTimings: {
      preprocessMs: 0,
      modalDetectMs: 0,
      labelOcrMs: 0,
      valueOcrMs: 0,
      headerOcrMs: 0,
      zipMs: 0,
      totalMs: 0,
    },
    userConfirmed: null,
    userRejectedReason: null,
  };
}

function resolveBboxOverlays(
  row: typeof schema.screenshotOcrJobs.$inferSelect,
  diagnostics: Record<string, unknown> | null,
): ScreenshotOcrBboxOverlay[] {
  const fromDiagnostics = readOverlays(diagnostics?.bboxOverlays);
  if (fromDiagnostics.length > 0) return fromDiagnostics;

  const modal = row.modalRectJson as CropRect | null;
  if (!modal) return [];

  return assignOverlayIndices([
    {
      index: 0,
      fieldKey: "MODAL",
      rect: modalRectToBbox(modal),
      role: "modal",
    },
  ]);
}

function resolvePairedRows(
  diagnostics: Record<string, unknown> | null,
): ScreenshotOcrPairedRow[] {
  return readPairedRows(diagnostics?.pairedRows);
}

function mapListItem(
  row: typeof schema.screenshotOcrJobs.$inferSelect,
): ScreenshotOcrJobListItem {
  const quality = readQuality(row.qualityJson) ?? defaultQuality(row);

  return {
    id: row.id,
    source: row.source as ScreenshotOcrJobSource,
    parsedOk: Boolean(row.parsedOk),
    complete: quality.complete,
    failureCodes: quality.failureCodes,
    pairedCount: quality.pairedCount,
    expectedPairCount: quality.expectedPairCount,
    headerTotal: quality.headerTotal,
    layoutClass: quality.layoutClass,
    totalMs: quality.phaseTimings.totalMs,
    allianceId: row.allianceId,
    hqUserId: row.hqUserId,
    createdAt: isoOrNull(row.createdAt),
  };
}

function buildListConditions(query: ScreenshotOcrJobsListQuery): SQL[] {
  return [
    query.source ? eq(schema.screenshotOcrJobs.source, query.source) : undefined,
    query.parsedOk != null
      ? eq(schema.screenshotOcrJobs.parsedOk, query.parsedOk ? 1 : 0)
      : undefined,
  ].filter((condition): condition is SQL => Boolean(condition));
}

export async function listScreenshotOcrJobs(query: ScreenshotOcrJobsListQuery): Promise<{
  jobs: ScreenshotOcrJobListItem[];
  total: number;
}> {
  const db = getDb();
  const conditions = buildListConditions(query);

  const [totalRow] =
    conditions.length > 0
      ? await db
          .select({ total: count() })
          .from(schema.screenshotOcrJobs)
          .where(and(...conditions))
      : await db.select({ total: count() }).from(schema.screenshotOcrJobs);

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(schema.screenshotOcrJobs)
          .where(and(...conditions))
          .orderBy(desc(schema.screenshotOcrJobs.createdAt))
          .limit(query.limit)
          .offset(query.offset)
      : await db
          .select()
          .from(schema.screenshotOcrJobs)
          .orderBy(desc(schema.screenshotOcrJobs.createdAt))
          .limit(query.limit)
          .offset(query.offset);

  return {
    jobs: rows.map(mapListItem),
    total: Number(totalRow?.total ?? 0),
  };
}

export async function loadScreenshotOcrJobDetail(
  jobId: string,
): Promise<ScreenshotOcrJobDetailReport | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.screenshotOcrJobs)
    .where(eq(schema.screenshotOcrJobs.id, jobId))
    .limit(1);

  if (!row) return null;

  const diagnostics = readDiagnostics(row.diagnosticsJson);
  const quality = readQuality(row.qualityJson) ?? defaultQuality(row);
  const bboxOverlays = resolveBboxOverlays(row, diagnostics);
  const pairedRows = resolvePairedRows(diagnostics);
  const listItem = mapListItem(row);

  return {
    job: {
      ...listItem,
      sourceWidth: row.sourceWidth,
      sourceHeight: row.sourceHeight,
      quality,
      bboxOverlays,
      pairedRows,
      diagnostics,
      previews: {
        full: screenshotOcrJobPreviewHref(row.id, "full"),
        modal: screenshotOcrJobPreviewHref(row.id, "modal"),
        labelBand: screenshotOcrJobPreviewHref(row.id, "label-band"),
        valueBand: screenshotOcrJobPreviewHref(row.id, "value-band"),
      },
    },
  };
}

export function resolveScreenshotOcrPreviewStorageKey(
  jobId: string,
  kind: ScreenshotPreviewKind,
): string {
  return screenshotOcrPreviewKey(jobId, API_TO_STORAGE_PREVIEW_KIND[kind]);
}
