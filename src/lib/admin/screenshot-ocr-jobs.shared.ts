import type { OcrDiagnosticsSource } from "@/lib/ocr/ocr-diagnostics.shared";
import type { ScreenshotOcrBboxOverlay } from "@/lib/ocr/screenshot-ocr-geometry.shared";
import type {
  ScreenshotOcrFailureCode,
  ScreenshotOcrQualityMetrics,
} from "@/lib/ocr/screenshot-ocr-quality.shared";

export type ScreenshotOcrJobSource = Extract<
  OcrDiagnosticsSource,
  "thp_screenshot" | "kills_screenshot"
>;

export const SCREENSHOT_OCR_JOB_SOURCES: ScreenshotOcrJobSource[] = [
  "thp_screenshot",
  "kills_screenshot",
];

export type ScreenshotPreviewKind =
  | "full"
  | "modal"
  | "label-band"
  | "value-band";

export const SCREENSHOT_PREVIEW_KINDS: ScreenshotPreviewKind[] = [
  "full",
  "modal",
  "label-band",
  "value-band",
];

export type ScreenshotOcrPairedRow = {
  key: string | null;
  label: string;
  valueText: string;
  value: number | null;
  yNorm: number;
};

export type ScreenshotOcrJobListItem = {
  id: string;
  source: ScreenshotOcrJobSource;
  parsedOk: boolean;
  complete: boolean;
  failureCodes: ScreenshotOcrFailureCode[];
  pairedCount: number;
  expectedPairCount: number;
  headerTotal: number | null;
  layoutClass: string;
  totalMs: number | null;
  allianceId: string | null;
  hqUserId: string | null;
  createdAt: string | null;
};

export type ScreenshotOcrJobDetailReport = {
  job: ScreenshotOcrJobListItem & {
    sourceWidth: number;
    sourceHeight: number;
    quality: ScreenshotOcrQualityMetrics;
    bboxOverlays: ScreenshotOcrBboxOverlay[];
    pairedRows: ScreenshotOcrPairedRow[];
    diagnostics: Record<string, unknown> | null;
    previews: {
      full: string;
      modal: string | null;
      labelBand: string | null;
      valueBand: string | null;
    };
  };
};

export const SCREENSHOT_OCR_FAILURE_LABELS: Record<
  ScreenshotOcrFailureCode,
  string
> = {
  crop_misaligned: "Crop misaligned",
  row_shift: "Row shift",
  header_ratio_implausible: "Header ratio implausible",
  sum_mismatch: "Sum mismatch",
  header_digit_noise: "Header digit noise",
  too_few_ocr_lines: "Too few OCR lines",
  unmatched_value_lines: "Unmatched value lines",
  anomaly_threshold: "Anomaly threshold",
  user_rejected: "User rejected",
};

export type ScreenshotOcrJobsListQuery = {
  source: ScreenshotOcrJobSource | null;
  parsedOk: boolean | null;
  limit: number;
  offset: number;
};

export function parseScreenshotOcrJobsListQuery(
  searchParams: URLSearchParams,
): ScreenshotOcrJobsListQuery {
  const rawLimit = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.trunc(rawLimit)), 200)
    : 100;
  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.trunc(rawOffset))
    : 0;

  const sourceParam = searchParams.get("source");
  const source =
    sourceParam &&
    sourceParam !== "all" &&
    SCREENSHOT_OCR_JOB_SOURCES.includes(sourceParam as ScreenshotOcrJobSource)
      ? (sourceParam as ScreenshotOcrJobSource)
      : null;

  const parsedOkParam = searchParams.get("parsedOk");
  let parsedOk: boolean | null = null;
  if (parsedOkParam === "true") parsedOk = true;
  if (parsedOkParam === "false") parsedOk = false;

  return { source, parsedOk, limit, offset };
}

export function screenshotOcrJobDetailHref(jobId: string): string {
  return `/admin/screenshot-jobs/${jobId}`;
}

export function screenshotOcrJobPreviewHref(
  jobId: string,
  kind: ScreenshotPreviewKind,
): string {
  return `/api/admin/screenshot-jobs/${jobId}/preview/${kind}`;
}

export function screenshotOcrJobsListHref(input?: {
  source?: string;
  parsedOk?: string;
}): string {
  const params = new URLSearchParams();
  if (input?.source && input.source !== "all") {
    params.set("source", input.source);
  }
  if (input?.parsedOk && input.parsedOk !== "all") {
    params.set("parsedOk", input.parsedOk);
  }
  const qs = params.toString();
  return qs ? `/admin/screenshot-jobs?${qs}` : "/admin/screenshot-jobs";
}

export function isScreenshotPreviewKind(
  value: string,
): value is ScreenshotPreviewKind {
  return (SCREENSHOT_PREVIEW_KINDS as readonly string[]).includes(value);
}

export function formatScreenshotOcrSource(source: ScreenshotOcrJobSource): string {
  switch (source) {
    case "thp_screenshot":
      return "THP screenshot";
    case "kills_screenshot":
      return "Kills screenshot";
    default:
      return source;
  }
}
