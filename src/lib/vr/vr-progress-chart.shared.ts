export type VrProgressChartEvent = {
  at: string;
  baseVr: number;
  instituteLevel: number | null;
};

export type VrProgressCommanderSeries = {
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  rank: number;
  currentBaseVr: number;
  isViewer: boolean;
  events: VrProgressChartEvent[];
};

export type VrProgressChartPayload = {
  seasonKey: string;
  vrUpdatesLocked: boolean;
  series: VrProgressCommanderSeries[];
};

export function selectTopVrChartCommanders<
  T extends { commanderId: string; currentBaseVr: number },
>(ranked: T[], viewerCommanderId: string | null, limit = 10): T[] {
  const sorted = ranked
    .slice()
    .sort((a, b) => b.currentBaseVr - a.currentBaseVr)
    .slice(0, Math.max(0, limit));

  if (!viewerCommanderId || sorted.some((row) => row.commanderId === viewerCommanderId)) {
    return sorted;
  }

  const viewer = ranked.find((row) => row.commanderId === viewerCommanderId);
  if (!viewer) return sorted;

  if (sorted.length < limit) {
    return [...sorted, viewer];
  }

  if (sorted.length === 0) return [viewer];
  return [...sorted.slice(0, -1), viewer];
}
