import {
  KILLS_PERCENTILE_WINDOWS,
  type KillsPercentileWindow,
} from "@/lib/kills/constants";
import { computeKillsPercentile } from "@/lib/kills/percentile";
import type { MyKillsPercentileChange } from "@/lib/kills/my-kills.shared";

export type CommanderKillsSnapshot = {
  commanderId: string;
  total: number;
  recordedAt: Date;
};

export function commanderKillsAtOrBefore(
  events: readonly CommanderKillsSnapshot[],
  asOf: Date,
): number | null {
  let best: CommanderKillsSnapshot | null = null;
  for (const event of events) {
    if (event.recordedAt.getTime() > asOf.getTime()) continue;
    if (!best || event.recordedAt.getTime() > best.recordedAt.getTime()) {
      best = event;
    }
  }
  return best?.total ?? null;
}

export function computeKillsPercentileChange(input: {
  viewerCommanderId: string;
  viewerEvents: readonly CommanderKillsSnapshot[];
  allianceEventsByCommander: ReadonlyMap<
    string,
    readonly CommanderKillsSnapshot[]
  >;
  now?: Date;
}): MyKillsPercentileChange[] {
  const now = input.now ?? new Date();
  const viewerNow = commanderKillsAtOrBefore(input.viewerEvents, now);
  const nowPopulation: number[] = [];
  for (const [commanderId, events] of input.allianceEventsByCommander) {
    const total = commanderKillsAtOrBefore(events, now);
    if (total != null) {
      nowPopulation.push(total);
    }
    void commanderId;
  }
  const percentileNow =
    viewerNow != null ? computeKillsPercentile(nowPopulation, viewerNow) : null;

  return KILLS_PERCENTILE_WINDOWS.map((days) => {
    const asOf = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const viewerThen = commanderKillsAtOrBefore(input.viewerEvents, asOf);
    const thenPopulation: number[] = [];
    for (const events of input.allianceEventsByCommander.values()) {
      const total = commanderKillsAtOrBefore(events, asOf);
      if (total != null) thenPopulation.push(total);
    }
    const percentileThen =
      viewerThen != null
        ? computeKillsPercentile(thenPopulation, viewerThen)
        : null;
    const delta =
      percentileThen?.percentile != null && percentileNow?.percentile != null
        ? percentileNow.percentile - percentileThen.percentile
        : null;
    return {
      days,
      percentileThen: percentileThen?.percentile ?? null,
      percentileNow: percentileNow?.percentile ?? null,
      delta,
    };
  });
}

export type { KillsPercentileWindow };
