import type { AccountTimezoneId } from "@/lib/timezone/constants";
import { DEFAULT_ACCOUNT_TIMEZONE_ID } from "@/lib/timezone/constants";
import {
  accountCalendarDateToUtcStart,
  formatAccountDate,
} from "@/lib/timezone/format";

/** Parse YYYY-MM-DD (and ISO datetime prefixes) into a local calendar date. */
export function parseEventDateString(
  raw: string | null | undefined,
): Date | null {
  if (!raw?.trim()) {
    return null;
  }

  const datePart = raw.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEventOptionLabel(options: {
  eventTypeLabel: string;
  eventDate?: string | Date | null;
  locale: string;
  timezoneId?: AccountTimezoneId;
}): string {
  const {
    eventTypeLabel,
    eventDate,
    locale,
    timezoneId = DEFAULT_ACCOUNT_TIMEZONE_ID,
  } = options;

  if (typeof eventDate === "string") {
    const datePart = eventDate.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const utcInstant = accountCalendarDateToUtcStart(
        datePart,
        DEFAULT_ACCOUNT_TIMEZONE_ID,
      );
      if (utcInstant) {
        return `${eventTypeLabel} ${formatAccountDate(utcInstant, {
          locale,
          timezoneId,
        })}`;
      }
    }
  }

  const date =
    eventDate instanceof Date
      ? eventDate
      : parseEventDateString(
          typeof eventDate === "string" ? eventDate : undefined,
        );

  if (!date) {
    return eventTypeLabel;
  }

  return `${eventTypeLabel} ${formatAccountDate(date, { locale, timezoneId })}`;
}

export type AshedEventLike = {
  id: string;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  event_date?: string | null;
  recorded_date?: string | null;
  date?: string | null;
};

const ASHED_EVENT_DATE_FIELDS = [
  "start_date",
  "end_date",
  "event_date",
  "recorded_date",
  "date",
] as const satisfies ReadonlyArray<keyof AshedEventLike>;

export function resolveAshedEventDate(event: AshedEventLike): string | null {
  for (const field of ASHED_EVENT_DATE_FIELDS) {
    const value = event[field]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function formatAshedEventOptionLabel(options: {
  eventTypeLabel: string;
  event: AshedEventLike;
  locale: string;
  timezoneId?: AccountTimezoneId;
}): string {
  return formatEventOptionLabel({
    eventTypeLabel: options.eventTypeLabel,
    eventDate: resolveAshedEventDate(options.event),
    locale: options.locale,
    timezoneId: options.timezoneId,
  });
}

export type HqEventLike = {
  id: string;
  name?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export function formatHqEventOptionLabel(options: {
  eventTypeLabel: string;
  event: HqEventLike;
  locale: string;
  timezoneId?: AccountTimezoneId;
}): string {
  return formatEventOptionLabel({
    eventTypeLabel: options.eventTypeLabel,
    eventDate: options.event.startDate ?? options.event.endDate ?? null,
    locale: options.locale,
    timezoneId: options.timezoneId,
  });
}
