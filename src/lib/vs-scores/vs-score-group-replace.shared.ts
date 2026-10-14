/**
 * When a multi-pass VS upload group re-submits from a different selected job,
 * heads/batches stamped by sibling passes for the same date+period must be
 * treated as the prior revision being replaced — not left as hybrid leftovers.
 */

export function replaceSourceJobIdsForVsCommit(input: {
  jobId: string;
  groupId: string | null | undefined;
  siblingJobIds: readonly string[];
}): string[] {
  if (!input.groupId) return [input.jobId];
  const ids = new Set<string>([input.jobId]);
  for (const id of input.siblingJobIds) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Own job: clear any prior head for that job (supports recordedDate moves).
 * Sibling jobs in the same group: only clear the commit's date+period so other
 * days stamped by a companion pass are left alone.
 */
export function shouldClearVsHeadOnGroupReplace(input: {
  head: {
    sourceJobId: string | null;
    recordedDate: string;
    period: string;
  };
  commitJobId: string;
  commitRecordedDate: string;
  commitPeriod: string;
  replaceJobIds: readonly string[];
}): boolean {
  const sourceJobId = input.head.sourceJobId;
  if (!sourceJobId || !input.replaceJobIds.includes(sourceJobId)) return false;
  if (sourceJobId === input.commitJobId) return true;
  return (
    input.head.recordedDate === input.commitRecordedDate &&
    input.head.period === input.commitPeriod
  );
}
