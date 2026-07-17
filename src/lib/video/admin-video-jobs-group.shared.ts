/**
 * Group admin video jobs so primary + shadow passes for the same upload
 * stay contiguous in the index (and neighbor navigation).
 */

export type AdminVideoJobGroupFields = {
  id: string;
  groupId: string | null;
  passRole: string | null;
  passIndex: number | null;
  createdAt: string | Date;
};

export type AdminVideoJobListGroup<T extends AdminVideoJobGroupFields> = {
  /** Stable key for React lists (`groupId` or solo job id). */
  key: string;
  groupId: string | null;
  jobs: T[];
};

function createdAtMs(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function passSortRank(job: AdminVideoJobGroupFields): number {
  if (job.passRole === "primary" || job.passRole == null) return 0;
  if (job.passRole === "shadow") return 1;
  return 2;
}

function compareWithinGroup(
  a: AdminVideoJobGroupFields,
  b: AdminVideoJobGroupFields,
): number {
  const role = passSortRank(a) - passSortRank(b);
  if (role !== 0) return role;
  const aIndex = a.passIndex ?? Number.MAX_SAFE_INTEGER;
  const bIndex = b.passIndex ?? Number.MAX_SAFE_INTEGER;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
}

/**
 * Cluster jobs by `groupId` (null = solo). Groups ordered by newest member
 * first; within a group: primary, then shadow by `passIndex` / createdAt.
 */
export function groupAdminVideoJobsForIndex<T extends AdminVideoJobGroupFields>(
  jobs: readonly T[],
): AdminVideoJobListGroup<T>[] {
  const solo: AdminVideoJobListGroup<T>[] = [];
  const byGroupId = new Map<string, T[]>();
  const groupFirstSeen = new Map<string, number>();

  jobs.forEach((job, index) => {
    const groupId = job.groupId;
    if (!groupId) {
      solo.push({ key: job.id, groupId: null, jobs: [job] });
      return;
    }
    const bucket = byGroupId.get(groupId);
    if (bucket) {
      bucket.push(job);
    } else {
      byGroupId.set(groupId, [job]);
      groupFirstSeen.set(groupId, index);
    }
  });

  const multi: AdminVideoJobListGroup<T>[] = [];
  for (const [groupId, members] of byGroupId) {
    const sorted = [...members].sort(compareWithinGroup);
    multi.push({ key: groupId, groupId, jobs: sorted });
  }

  // Preserve relative order of first appearance in the input list, which is
  // newest-first from the DB — so groups stay near their primary's position.
  const multiOrdered = multi.sort((a, b) => {
    const aSeen = groupFirstSeen.get(a.groupId!) ?? 0;
    const bSeen = groupFirstSeen.get(b.groupId!) ?? 0;
    return aSeen - bSeen;
  });

  // Merge solo + multi by first-seen index in the original list.
  type Entry = { firstIndex: number; group: AdminVideoJobListGroup<T> };
  const entries: Entry[] = [
    ...solo.map((group) => ({
      firstIndex: jobs.findIndex((j) => j.id === group.jobs[0]!.id),
      group,
    })),
    ...multiOrdered.map((group) => ({
      firstIndex: groupFirstSeen.get(group.groupId!) ?? 0,
      group,
    })),
  ];
  entries.sort((a, b) => a.firstIndex - b.firstIndex);
  return entries.map((e) => e.group);
}

/** Flatten grouped jobs for neighbor navigation / flat consumers. */
export function flattenAdminVideoJobGroups<T extends AdminVideoJobGroupFields>(
  groups: readonly AdminVideoJobListGroup<T>[],
): T[] {
  return groups.flatMap((g) => g.jobs);
}

export function orderAdminVideoJobsForIndex<T extends AdminVideoJobGroupFields>(
  jobs: readonly T[],
): T[] {
  return flattenAdminVideoJobGroups(groupAdminVideoJobsForIndex(jobs));
}
