export type ExperimentDetailArm = {
  id: string;
  name: string;
  isControl: boolean;
  configId: string | null;
  trafficWeight: number;
  config: { name: string; passKey: string } | null;
};

export type ExperimentDetailGroup = {
  id: string;
  experimentArmId: string | null;
  scoreTarget: string | null;
  boardKey: string | null;
  hqEventId: string | null;
};

export type ExperimentDetailJob = {
  id: string;
  groupId: string | null;
  passRole: string | null;
  passKey: string | null;
  rating: string | null;
  qualityScore: number | null;
  qualityBucket: string | null;
  createdAt: Date | string;
};

export type ExperimentArmStats = ExperimentDetailArm & {
  jobCount: number;
  ratedCount: number;
  thumbsUpCount: number;
  avgQualityScore: number | null;
  qualityBuckets: Record<string, number>;
};

export type ExperimentDailyPoint = {
  date: string;
  armId: string;
  rated: number;
  thumbsUp: number;
};

export type ExperimentPopulationRow = {
  scoreTarget: string;
  boardKey: string | null;
  hqEventId: string | null;
  count: number;
};

function dateKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Officer ratings persist as thumbs_up / thumbs_down; accept legacy up/down. */
export function isThumbsUpRating(rating: string | null | undefined): boolean {
  return rating === "thumbs_up" || rating === "up";
}

/**
 * Evaluate the officer-facing primary job for an arm's upload group.
 * Extraction experiments A/B the primary; shadows are engine-comparison only.
 */
export function selectEvaluatedJob(
  jobs: ExperimentDetailJob[],
): ExperimentDetailJob | null {
  return jobs.find((job) => job.passRole === "primary") ?? jobs[0] ?? null;
}

export function buildExperimentDetailAnalytics(params: {
  arms: ExperimentDetailArm[];
  groups: ExperimentDetailGroup[];
  jobs: ExperimentDetailJob[];
}): {
  arms: ExperimentArmStats[];
  dailySeries: ExperimentDailyPoint[];
  population: ExperimentPopulationRow[];
} {
  const groupsByArm = new Map<string, ExperimentDetailGroup[]>();
  for (const group of params.groups) {
    if (!group.experimentArmId) continue;
    const rows = groupsByArm.get(group.experimentArmId) ?? [];
    rows.push(group);
    groupsByArm.set(group.experimentArmId, rows);
  }

  const jobsByGroup = new Map<string, ExperimentDetailJob[]>();
  for (const job of params.jobs) {
    if (!job.groupId) continue;
    const rows = jobsByGroup.get(job.groupId) ?? [];
    rows.push(job);
    jobsByGroup.set(job.groupId, rows);
  }

  const dailyByKey = new Map<string, ExperimentDailyPoint>();

  const armStats = params.arms.map((arm) => {
    const armGroups = groupsByArm.get(arm.id) ?? [];
    let ratedCount = 0;
    let thumbsUpCount = 0;
    let qualityTotal = 0;
    let qualityCount = 0;
    const qualityBuckets: Record<string, number> = {};

    for (const group of armGroups) {
      const evaluatedJob = selectEvaluatedJob(jobsByGroup.get(group.id) ?? []);
      if (!evaluatedJob) continue;

      if (evaluatedJob.rating != null) {
        ratedCount += 1;
        if (isThumbsUpRating(evaluatedJob.rating)) thumbsUpCount += 1;

        const key = `${dateKey(evaluatedJob.createdAt)}::${arm.id}`;
        const point = dailyByKey.get(key) ?? {
          date: dateKey(evaluatedJob.createdAt),
          armId: arm.id,
          rated: 0,
          thumbsUp: 0,
        };
        point.rated += 1;
        if (isThumbsUpRating(evaluatedJob.rating)) point.thumbsUp += 1;
        dailyByKey.set(key, point);
      }

      if (evaluatedJob.qualityScore != null) {
        qualityTotal += evaluatedJob.qualityScore;
        qualityCount += 1;
      }

      if (evaluatedJob.qualityBucket) {
        qualityBuckets[evaluatedJob.qualityBucket] =
          (qualityBuckets[evaluatedJob.qualityBucket] ?? 0) + 1;
      }
    }

    return {
      ...arm,
      jobCount: armGroups.length,
      ratedCount,
      thumbsUpCount,
      avgQualityScore: qualityCount > 0 ? qualityTotal / qualityCount : null,
      qualityBuckets,
    };
  });

  const populationByKey = new Map<string, ExperimentPopulationRow>();
  for (const group of params.groups) {
    const scoreTarget = group.scoreTarget ?? "unknown";
    const key = `${scoreTarget}::${group.boardKey ?? ""}::${group.hqEventId ?? ""}`;
    const row = populationByKey.get(key) ?? {
      scoreTarget,
      boardKey: group.boardKey,
      hqEventId: group.hqEventId,
      count: 0,
    };
    row.count += 1;
    populationByKey.set(key, row);
  }

  return {
    arms: armStats,
    dailySeries: [...dailyByKey.values()].sort((a, b) =>
      a.date === b.date ? a.armId.localeCompare(b.armId) : a.date.localeCompare(b.date),
    ),
    population: [...populationByKey.values()].sort((a, b) =>
      a.scoreTarget === b.scoreTarget
        ? (a.boardKey ?? "").localeCompare(b.boardKey ?? "")
        : a.scoreTarget.localeCompare(b.scoreTarget),
    ),
  };
}
