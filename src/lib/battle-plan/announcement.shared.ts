import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import {
  markerPresetI18nKey,
  type MarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

export const ANNOUNCEMENT_WINDOW_HOURS = 24;

export type BattlePlanAnnouncementStrings = {
  stronghold: string;
  city: string;
  serverTimeSuffix: string;
  summary: (cityCount: number, strongholdCount: number) => string;
  policyWar: string;
  policyPeace: string;
  seasonDisclaimer: string;
  empty: string;
  markerLabel: (preset: MarkerIconPreset) => string;
  dropLine: (input: {
    markerLabel: string;
    dropServerTime: string;
  }) => string;
};

export function formatServerCaptureTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SERVER_TIME_IANA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function listCaptureEventsInNextHours(
  events: readonly SerializedCaptureEvent[],
  hours: number,
  now = new Date(),
): SerializedCaptureEvent[] {
  const nowMs = now.getTime();
  const endMs = nowMs + hours * 60 * 60 * 1000;
  return events
    .filter(
      (event) =>
        event.status === "scheduled" &&
        new Date(event.scheduledAt).getTime() >= nowMs &&
        new Date(event.scheduledAt).getTime() < endMs,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
}

function formatEventLine(
  event: SerializedCaptureEvent,
  strings: BattlePlanAnnouncementStrings,
): string {
  const time = formatServerCaptureTime(event.scheduledAt);
  if (event.eventType === "drop") {
    const markerLabel = event.iconPreset
      ? strings.markerLabel(event.iconPreset)
      : "unmarked";
    return strings.dropLine({
      markerLabel,
      dropServerTime: time,
    });
  }
  const territory =
    event.territoryType === "stronghold"
      ? strings.stronghold
      : strings.city;
  const markerSuffix = event.iconPreset
    ? ` [${strings.markerLabel(event.iconPreset)}]`
    : "";
  return `${time} ${strings.serverTimeSuffix} - ${territory}${markerSuffix}`;
}

function groupLinesByServerDate(
  events: readonly SerializedCaptureEvent[],
  strings: BattlePlanAnnouncementStrings,
): string[] {
  const groups = new Map<string, string[]>();
  for (const event of events) {
    const lines = groups.get(event.serverCalendarDate) ?? [];
    lines.push(formatEventLine(event, strings));
    groups.set(event.serverCalendarDate, lines);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, lines]) => lines.join("\n"));
}

export function generateBattlePlanAnnouncement(
  events: readonly SerializedCaptureEvent[],
  options: {
    seasonKey: string;
    strings: BattlePlanAnnouncementStrings;
    now?: Date;
    hours?: number;
  },
): string {
  const hours = options.hours ?? ANNOUNCEMENT_WINDOW_HOURS;
  const upcoming = listCaptureEventsInNextHours(events, hours, options.now);
  if (upcoming.length === 0) {
    return options.strings.empty;
  }

  const captures = upcoming.filter((event) => event.eventType !== "drop");
  const cityCount = captures.filter((event) => event.territoryType === "city")
    .length;
  const strongholdCount = captures.filter(
    (event) => event.territoryType === "stronghold",
  ).length;
  const warTimeEvent = captures.some(
    (event) => event.effectiveCapturePolicy === "war",
  );

  const sections = [
    options.strings.summary(cityCount, strongholdCount),
    groupLinesByServerDate(upcoming, options.strings).join("\n\n"),
  ];

  if (captures.length > 0) {
    sections.push(
      warTimeEvent ? options.strings.policyWar : options.strings.policyPeace,
    );
  }

  if (options.seasonKey === "5") {
    sections.push(options.strings.seasonDisclaimer);
  }

  return sections.join("\n\n");
}

export function buildAnnouncementStrings(
  translate: (key: string, values?: Record<string, string | number>) => string,
): BattlePlanAnnouncementStrings {
  return {
    stronghold: translate("announcement.stronghold"),
    city: translate("announcement.city"),
    serverTimeSuffix: translate("announcement.serverTimeSuffix"),
    summary: (cityCount, strongholdCount) =>
      translate("announcement.summary", { cityCount, strongholdCount }),
    policyWar: translate("announcement.policyWar"),
    policyPeace: translate("announcement.policyPeace"),
    seasonDisclaimer: translate("announcement.seasonDisclaimer"),
    empty: translate("announcement.empty"),
    markerLabel: (preset) =>
      translate("announcement.markerLabel", {
        marker: translate(`markers.presets.${markerPresetI18nKey(preset)}`),
      }),
    dropLine: ({ markerLabel, dropServerTime }) =>
      translate("announcement.dropLine", { markerLabel, dropServerTime }),
  };
}
