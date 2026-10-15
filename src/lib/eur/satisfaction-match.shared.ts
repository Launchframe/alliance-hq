/**
 * Pure matching rules for EUR occurrence satisfaction.
 *
 * A video job may satisfy at most one open occurrence for the same
 * alliance + scoreTarget. Earlier occurrences claim jobs first; a job
 * timestamp must fall in [scheduledStartAt, nextOccurrenceStart).
 */

export type EurSatisfactionJobCandidate = {
  id: string;
  /** coalesce(updatedAt, createdAt) */
  at: Date;
};

export type EurSatisfactionOccurrenceCandidate = {
  id: string;
  allianceId: string;
  scoreTarget: string;
  scheduledStartAt: Date;
};

/**
 * Next open occurrence start for the same alliance + scoreTarget after
 * `occurrence`, or null when this is the latest open slot.
 */
export function nextEurOccurrenceStart(
  occurrence: EurSatisfactionOccurrenceCandidate,
  openSorted: readonly EurSatisfactionOccurrenceCandidate[],
): Date | null {
  for (const candidate of openSorted) {
    if (candidate.id === occurrence.id) continue;
    if (candidate.allianceId !== occurrence.allianceId) continue;
    if (candidate.scoreTarget !== occurrence.scoreTarget) continue;
    if (candidate.scheduledStartAt.getTime() > occurrence.scheduledStartAt.getTime()) {
      return candidate.scheduledStartAt;
    }
  }
  return null;
}

/**
 * Pick the earliest eligible unused job for one occurrence.
 * Returns null when no job falls in the occurrence window.
 */
export function pickEurSatisfyingJobId(input: {
  occurrenceScheduledStartAt: Date;
  nextOccurrenceScheduledStartAt: Date | null;
  candidateJobs: readonly EurSatisfactionJobCandidate[];
  usedJobIds: ReadonlySet<string>;
}): string | null {
  const startMs = input.occurrenceScheduledStartAt.getTime();
  const endMs = input.nextOccurrenceScheduledStartAt?.getTime() ?? null;

  let best: EurSatisfactionJobCandidate | null = null;
  for (const job of input.candidateJobs) {
    if (input.usedJobIds.has(job.id)) continue;
    const atMs = job.at.getTime();
    if (atMs < startMs) continue;
    if (endMs != null && atMs >= endMs) continue;
    if (!best || atMs < best.at.getTime()) {
      best = job;
    }
  }
  return best?.id ?? null;
}
