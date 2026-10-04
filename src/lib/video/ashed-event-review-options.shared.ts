import { ashedEventCalendarDate, pickAshedEventMatchingDate } from "@/lib/video/ashed-event-provision";
import {
  formatAshedEventOptionLabel,
  formatEventOptionLabel,
  type AshedEventLike,
} from "@/lib/video/event-option-label";
import type { AccountTimezoneId } from "@/lib/timezone/constants";

/** Sentinel for a recorded date that has no Ashed event yet (created on submit). */
export const ASHED_EVENT_AUTO_CREATE_ID = "__auto_create__";

export type ReviewAshedEventOption = {
  id: string;
  label: string;
  eventDate: string | null;
};

export function isAshedEventAutoCreateId(eventId: string | null | undefined): boolean {
  return !eventId || eventId === ASHED_EVENT_AUTO_CREATE_ID;
}

export function sortAshedEventsNewestFirst<T extends AshedEventLike>(
  events: T[],
): T[] {
  return [...events].sort((a, b) => {
    const da = ashedEventCalendarDate(a) ?? "";
    const db = ashedEventCalendarDate(b) ?? "";
    return db.localeCompare(da);
  });
}

/**
 * Event picker rows for review: existing Ashed events (newest first), plus
 * the recorded date when that day has no event yet so officers can target
 * today without waiting for a prior week's row.
 */
export function buildReviewAshedEventOptions(params: {
  events: AshedEventLike[];
  recordedDate: string;
  eventTypeLabel: string;
  locale: string;
  timezoneId?: AccountTimezoneId;
}): {
  options: ReviewAshedEventOption[];
  selectedEventId: string;
  willAutoCreate: boolean;
} {
  const recordedDate = params.recordedDate.trim().slice(0, 10);
  const sorted = sortAshedEventsNewestFirst(params.events).filter(
    (event): event is AshedEventLike & { id: string } => Boolean(event.id),
  );
  const existing: ReviewAshedEventOption[] = sorted.map((event) => ({
    id: event.id,
    label: formatAshedEventOptionLabel({
      eventTypeLabel: params.eventTypeLabel,
      event,
      locale: params.locale,
      timezoneId: params.timezoneId,
    }),
    eventDate: ashedEventCalendarDate(event),
  }));

  const matched = pickAshedEventMatchingDate(sorted, recordedDate);
  if (matched?.id) {
    return {
      options: existing,
      selectedEventId: matched.id,
      willAutoCreate: false,
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedDate)) {
    return {
      options: existing,
      selectedEventId: existing[0]?.id ?? "",
      willAutoCreate: existing.length === 0,
    };
  }

  const autoOption: ReviewAshedEventOption = {
    id: ASHED_EVENT_AUTO_CREATE_ID,
    label: formatEventOptionLabel({
      eventTypeLabel: params.eventTypeLabel,
      eventDate: recordedDate,
      locale: params.locale,
      timezoneId: params.timezoneId,
    }),
    eventDate: recordedDate,
  };

  return {
    options: [autoOption, ...existing],
    selectedEventId: ASHED_EVENT_AUTO_CREATE_ID,
    willAutoCreate: true,
  };
}
