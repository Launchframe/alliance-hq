import {
  THP_PERCENTILE_WINDOWS,
  type ThpPercentileWindow,
} from "@/lib/thp/constants";
import { computeThpPercentile } from "@/lib/thp/percentile";
import type { MyThpPercentileChange } from "@/lib/thp/my-thp.shared";

export type CommanderThpSnapshot = {
  commanderId: string;
  total: number;
  recordedAt: Date;
};

export function commanderThpAtOrBefore(
  events: readonly CommanderThpSnapshot[],
  asOf: Date,
): number | null {
  let best: CommanderThpSnapshot | null = null;
  for (const event of events) {
    if (event.recordedAt.getTime() > asOf.getTime()) continue;
    if (!best || event.recordedAt.getTime() > best.recordedAt.getTime()) {
      best = event;
    }
  }
  return best?.total ?? null;
}

export function computeThpPercentileChange(input: {
  viewerCommanderId: string;
  viewerEvents: readonly CommanderThpSnapshot[];
  allianceEventsByCommander: ReadonlyMap<string, readonly CommanderThpSnapshot[]>;
  now?: Date;
}): MyThpPercentileChange[] {
  const now = input.now ?? new Date();
  const viewerNow = commanderThpAtOrBefore(input.viewerEvents, now);
  const nowPopulation: number[] = [];
  for (const [commanderId, events] of input.allianceEventsByCommander) {
    const total = commanderThpAtOrBefore(events, now);
    if (total != null) {
      nowPopulation.push(total);
    }
    void commanderId;
  }
  const percentileNow =
    viewerNow != null ? computeThpPercentile(nowPopulation, viewerNow) : null;

  return THP_PERCENTILE_WINDOWS.map((days) => {
    const asOf = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const viewerThen = commanderThpAtOrBefore(input.viewerEvents, asOf);
    const thenPopulation: number[] = [];
    for (const events of input.allianceEventsByCommander.values()) {
      const total = commanderThpAtOrBefore(events, asOf);
      if (total != null) thenPopulation.push(total);
    }
    const percentileThen =
      viewerThen != null
        ? computeThpPercentile(thenPopulation, viewerThen)
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

export type { ThpPercentileWindow };
