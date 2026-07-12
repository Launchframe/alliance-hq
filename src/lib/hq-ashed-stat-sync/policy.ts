/** Pure inbound policy for monotonic HQ↔Ashed commander scalars (THP, kills). */

export const PROTECTED_HQ_STAT_SOURCES = [
  "web",
  "discord",
  "screenshot_ocr",
  "video_parse",
] as const;

export type ProtectedHqStatSource = (typeof PROTECTED_HQ_STAT_SOURCES)[number];

export type InboundStatDecision = "noop" | "apply" | "conflict";

export type InboundStatCompareInput = {
  hqTotal: number | null;
  /** Latest non-discarded HQ event source, if known. */
  hqLatestSource: string | null;
  /** True when current HQ total comes from a protected source with ashed_synced_at null. */
  hqPendingUnsyncedSelfReport: boolean;
  hqUpdatedAt: Date | null;
  ashedTotal: number;
  ashedRecordedAt: Date | null;
};

export function isProtectedHqStatSource(source: string | null | undefined): boolean {
  return (
    source != null &&
    (PROTECTED_HQ_STAT_SOURCES as readonly string[]).includes(source)
  );
}

export function decideInboundStatApply(
  input: InboundStatCompareInput,
): InboundStatDecision {
  const ashed = Math.round(input.ashedTotal);
  if (!Number.isFinite(ashed) || ashed <= 0) {
    return "noop";
  }

  const hq =
    input.hqTotal != null && Number.isFinite(input.hqTotal)
      ? Math.round(input.hqTotal)
      : null;

  if (hq != null && hq === ashed) {
    return "noop";
  }

  // Never auto-regress a pending / protected self-report with a lower Ashed value.
  if (
    hq != null &&
    ashed < hq &&
    (input.hqPendingUnsyncedSelfReport || isProtectedHqStatSource(input.hqLatestSource))
  ) {
    return "conflict";
  }

  // Ashed higher than HQ — growth; apply unless we somehow have equal (handled above).
  if (hq == null || ashed > hq) {
    return "apply";
  }

  // ashed < hq and not protected: use recency if both dates exist.
  if (input.ashedRecordedAt && input.hqUpdatedAt) {
    if (input.ashedRecordedAt.getTime() > input.hqUpdatedAt.getTime()) {
      // Newer but lower — still suspect for monotonic stats → conflict
      return "conflict";
    }
    return "noop";
  }

  // Ambiguous lower remote without clear protection → conflict for officer review
  return "conflict";
}
