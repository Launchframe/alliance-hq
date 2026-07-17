import type { PassComparison } from "@/lib/video/compare-pass-results";
import type { RosterTesseractEvalComparison } from "@/lib/video/compare-roster-ocr-quality";
import {
  isDepositSlipFingerprintShadowComparison,
  type DepositSlipFingerprintShadowComparison,
} from "@/lib/banks/deposit-slip-ocr/compare-deposit-slip-ocr-quality.shared";

/** Merged comparison payload stored on video_upload_groups.comparison_json. */
export type GroupComparisons = {
  extraction_shadow?: PassComparison;
  roster_tesseract_eval?: RosterTesseractEvalComparison;
  deposit_slip_fingerprint_shadow?: DepositSlipFingerprintShadowComparison;
};

function isPassComparison(value: unknown): value is PassComparison {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as PassComparison).passes)
  );
}

function isLegacyRosterEval(value: unknown): value is RosterTesseractEvalComparison {
  return (
    !!value &&
    typeof value === "object" &&
    (value as RosterTesseractEvalComparison).kind === "roster_tesseract_eval"
  );
}

export function parseGroupComparisons(raw: unknown): GroupComparisons {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const obj = raw as Record<string, unknown>;

  if (
    obj.extraction_shadow ||
    obj.roster_tesseract_eval ||
    obj.deposit_slip_fingerprint_shadow
  ) {
    return {
      extraction_shadow: isPassComparison(obj.extraction_shadow)
        ? obj.extraction_shadow
        : undefined,
      roster_tesseract_eval: isLegacyRosterEval(obj.roster_tesseract_eval)
        ? obj.roster_tesseract_eval
        : undefined,
      deposit_slip_fingerprint_shadow: isDepositSlipFingerprintShadowComparison(
        obj.deposit_slip_fingerprint_shadow,
      )
        ? obj.deposit_slip_fingerprint_shadow
        : undefined,
    };
  }

  if (isLegacyRosterEval(raw)) {
    return { roster_tesseract_eval: raw };
  }

  if (isPassComparison(raw)) {
    return { extraction_shadow: raw };
  }

  return {};
}

export function mergeGroupComparisons(
  existing: unknown,
  patch: Partial<GroupComparisons>,
): GroupComparisons {
  const current = parseGroupComparisons(existing);
  return {
    ...current,
    ...patch,
  };
}

export function getExtractionPassComparison(raw: unknown): PassComparison | null {
  return parseGroupComparisons(raw).extraction_shadow ?? null;
}

export function getRosterTesseractEvalComparison(
  raw: unknown,
): RosterTesseractEvalComparison | null {
  return parseGroupComparisons(raw).roster_tesseract_eval ?? null;
}

export function getDepositSlipFingerprintShadowComparison(
  raw: unknown,
): DepositSlipFingerprintShadowComparison | null {
  return parseGroupComparisons(raw).deposit_slip_fingerprint_shadow ?? null;
}
