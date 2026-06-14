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
}): string {
  const { eventTypeLabel, eventDate, locale } = options;
  const date =
    eventDate instanceof Date
      ? eventDate
      : parseEventDateString(
          typeof eventDate === "string" ? eventDate : undefined,
        );

  if (!date) {
    return eventTypeLabel;
  }

  const formattedDate = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  }).format(date);

  return `${eventTypeLabel} ${formattedDate}`;
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
}): string {
  return formatEventOptionLabel({
    eventTypeLabel: options.eventTypeLabel,
    eventDate: resolveAshedEventDate(options.event),
    locale: options.locale,
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
}): string {
  return formatEventOptionLabel({
    eventTypeLabel: options.eventTypeLabel,
    eventDate: options.event.startDate ?? options.event.endDate ?? null,
    locale: options.locale,
  });
}
