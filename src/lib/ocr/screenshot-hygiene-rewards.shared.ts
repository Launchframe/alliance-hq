import type { ScreenshotOcrFailureCode } from "@/lib/ocr/screenshot-ocr-quality.shared";

export type ScreenshotHygieneReward = {
  subjectKey: string;
  source: string;
  jobCount: number;
  parseOkRate: number;
  completeRate: number;
  avgPairedCount: number;
  topFailureCode: ScreenshotOcrFailureCode | null;
  confirmRejectRate: number;
};

export type ScreenshotHygieneFleetKpis = {
  jobCount: number;
  parseOkRate: number;
  completeRate: number;
  avgPairedCount: number;
  topFailureCodes: Array<{ code: ScreenshotOcrFailureCode; count: number }>;
  confirmRejectRate: number;
};

export function aggregateScreenshotHygieneRewards(
  rows: Array<{
    subjectKey: string;
    source: string;
    parsedOk: boolean;
    complete: boolean;
    pairedCount: number;
    failureCodes: ScreenshotOcrFailureCode[];
    userConfirmed: boolean | null;
  }>,
): ScreenshotHygieneReward[] {
  const bySubject = new Map<
    string,
    {
      source: string;
      jobCount: number;
      parseOkCount: number;
      completeCount: number;
      pairedSum: number;
      failureCounts: Map<ScreenshotOcrFailureCode, number>;
      confirmCount: number;
      rejectCount: number;
    }
  >();

  for (const row of rows) {
    const bucket = bySubject.get(row.subjectKey) ?? {
      source: row.source,
      jobCount: 0,
      parseOkCount: 0,
      completeCount: 0,
      pairedSum: 0,
      failureCounts: new Map(),
      confirmCount: 0,
      rejectCount: 0,
    };
    bucket.jobCount += 1;
    if (row.parsedOk) bucket.parseOkCount += 1;
    if (row.complete) bucket.completeCount += 1;
    bucket.pairedSum += row.pairedCount;
    for (const code of row.failureCodes) {
      bucket.failureCounts.set(code, (bucket.failureCounts.get(code) ?? 0) + 1);
    }
    if (row.userConfirmed === true) bucket.confirmCount += 1;
    if (row.userConfirmed === false) bucket.rejectCount += 1;
    bySubject.set(row.subjectKey, bucket);
  }

  return [...bySubject.entries()].map(([subjectKey, bucket]) => {
    let topFailureCode: ScreenshotOcrFailureCode | null = null;
    let topCount = 0;
    for (const [code, count] of bucket.failureCounts) {
      if (count > topCount) {
        topFailureCode = code;
        topCount = count;
      }
    }
    const decided = bucket.confirmCount + bucket.rejectCount;
    return {
      subjectKey,
      source: bucket.source,
      jobCount: bucket.jobCount,
      parseOkRate: bucket.jobCount > 0 ? bucket.parseOkCount / bucket.jobCount : 0,
      completeRate:
        bucket.jobCount > 0 ? bucket.completeCount / bucket.jobCount : 0,
      avgPairedCount:
        bucket.jobCount > 0 ? bucket.pairedSum / bucket.jobCount : 0,
      topFailureCode,
      confirmRejectRate: decided > 0 ? bucket.rejectCount / decided : 0,
    };
  });
}

export function aggregateScreenshotHygieneFleetKpis(
  rows: Array<{
    parsedOk: boolean;
    complete: boolean;
    pairedCount: number;
    failureCodes: ScreenshotOcrFailureCode[];
    userConfirmed: boolean | null;
  }>,
): ScreenshotHygieneFleetKpis {
  const failureCounts = new Map<ScreenshotOcrFailureCode, number>();
  let parseOkCount = 0;
  let completeCount = 0;
  let pairedSum = 0;
  let confirmCount = 0;
  let rejectCount = 0;

  for (const row of rows) {
    if (row.parsedOk) parseOkCount += 1;
    if (row.complete) completeCount += 1;
    pairedSum += row.pairedCount;
    for (const code of row.failureCodes) {
      failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
    }
    if (row.userConfirmed === true) confirmCount += 1;
    if (row.userConfirmed === false) rejectCount += 1;
  }

  const topFailureCodes = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ code, count }));

  const decided = confirmCount + rejectCount;
  return {
    jobCount: rows.length,
    parseOkRate: rows.length > 0 ? parseOkCount / rows.length : 0,
    completeRate: rows.length > 0 ? completeCount / rows.length : 0,
    avgPairedCount: rows.length > 0 ? pairedSum / rows.length : 0,
    topFailureCodes,
    confirmRejectRate: decided > 0 ? rejectCount / decided : 0,
  };
}
