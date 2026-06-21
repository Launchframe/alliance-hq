export type ConductorSwapRecord = {
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  lockedAt?: string | null;
};

export type ConductorSwapDayConfig = {
  date: string;
};

export type ConductorSwapCandidate = {
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  lockedAt: string | null;
};

export function canStartConductorSwap(
  record: ConductorSwapRecord | null | undefined,
): boolean {
  return Boolean(
    record?.conductorMemberId &&
      record.conductorMemberName &&
      record.lockedAt == null,
  );
}

export function conductorSwapCandidates(input: {
  sourceDate: string;
  dayConfigs: ConductorSwapDayConfig[];
  weekRecords: ConductorSwapRecord[];
}): ConductorSwapCandidate[] {
  return input.dayConfigs
    .filter((day) => day.date !== input.sourceDate)
    .map((day) => {
      const record = input.weekRecords.find((row) => row.date === day.date);
      return {
        date: day.date,
        conductorMemberId: record?.conductorMemberId ?? null,
        conductorMemberName: record?.conductorMemberName ?? null,
        lockedAt: record?.lockedAt ?? null,
      };
    })
    .filter((candidate) => candidate.lockedAt == null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
