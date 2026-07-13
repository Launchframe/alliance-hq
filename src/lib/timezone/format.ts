import {
  isServerTime,
  normalizeAccountTimezoneId,
  resolveAccountTimeZoneIana,
} from "@/lib/timezone/account";
import {
  DEFAULT_ACCOUNT_TIMEZONE_ID,
  SERVER_TIME_IANA,
  SERVER_TIME_UTC_OFFSET,
  type AccountTimezoneId,
} from "@/lib/timezone/constants";
import {
  formatOptionsIncludeClockTime,
  getBrowserTimeZoneIana,
  withTimeZoneLabel,
} from "@/lib/timezone/zone-label.shared";

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const offsetStr =
    formatted.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:(\+|-)(\d{1,2})(?::(\d{2}))?)?$/.exec(offsetStr);
  if (!match || !match[1]) {
    return 0;
  }
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

function parseCalendarDateString(
  raw: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function serverCalendarDateToUtcStart(date: string): Date | undefined {
  if (!date.trim()) {
    return undefined;
  }
  const parsed = new Date(`${date}T00:00:00.000${SERVER_TIME_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function serverCalendarDateToUtcEnd(date: string): Date | undefined {
  if (!date.trim()) {
    return undefined;
  }
  const parsed = new Date(`${date}T23:59:59.999${SERVER_TIME_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function zonedCalendarInstantToUtc(
  date: string,
  timeZone: string,
  endOfDay: boolean,
): Date | undefined {
  const parts = parseCalendarDateString(date);
  if (!parts) {
    return undefined;
  }

  if (timeZone === SERVER_TIME_IANA) {
    return endOfDay
      ? serverCalendarDateToUtcEnd(date)
      : serverCalendarDateToUtcStart(date);
  }

  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const ms = endOfDay ? 999 : 0;
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  const offsetMs = getTimeZoneOffsetMs(timeZone, anchor);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    second,
    ms,
  );
  return new Date(localAsUtc - offsetMs);
}

export function accountCalendarDateToUtcStart(
  date: string,
  timezoneId: AccountTimezoneId = DEFAULT_ACCOUNT_TIMEZONE_ID,
): Date | undefined {
  return zonedCalendarInstantToUtc(
    date,
    resolveAccountTimeZoneIana(normalizeAccountTimezoneId(timezoneId)),
    false,
  );
}

export function accountCalendarDateToUtcEnd(
  date: string,
  timezoneId: AccountTimezoneId = DEFAULT_ACCOUNT_TIMEZONE_ID,
): Date | undefined {
  return zonedCalendarInstantToUtc(
    date,
    resolveAccountTimeZoneIana(normalizeAccountTimezoneId(timezoneId)),
    true,
  );
}

export function formatAccountDateTime(
  value: Date | string,
  options: {
    locale: string;
    timezoneId?: AccountTimezoneId;
    /** When false, skip the ST / Local (TZ) suffix. Default true for clock times. */
    zoneLabel?: boolean;
  } & Intl.DateTimeFormatOptions,
): string {
  const {
    locale,
    timezoneId = DEFAULT_ACCOUNT_TIMEZONE_ID,
    zoneLabel,
    ...formatOptions
  } = options;
  const date = typeof value === "string" ? new Date(value) : value;
  const normalizedTimezoneId = normalizeAccountTimezoneId(timezoneId);
  const timeZone = resolveAccountTimeZoneIana(normalizedTimezoneId);
  const usesStyleOption =
    formatOptions.dateStyle !== undefined ||
    formatOptions.timeStyle !== undefined;

  const resolvedOptions: Intl.DateTimeFormatOptions = usesStyleOption
    ? { timeZone, ...formatOptions }
    : {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        ...formatOptions,
      };

  const formatted = new Intl.DateTimeFormat(locale, resolvedOptions).format(
    date,
  );

  const shouldLabel =
    zoneLabel ?? formatOptionsIncludeClockTime(resolvedOptions);
  if (!shouldLabel) {
    return formatted;
  }
  return withTimeZoneLabel(
    formatted,
    isServerTime(normalizedTimezoneId) ? "server" : "local",
    date,
    timeZone,
  );
}

/** Browser-local clock/datetime with a Local (TZ) suffix. */
export function formatBrowserLocalDateTime(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    timeStyle: "short",
  },
  locale?: string,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const timeZone = getBrowserTimeZoneIana();
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone,
    ...options,
  }).format(date);
  if (!formatOptionsIncludeClockTime(options)) {
    return formatted;
  }
  return withTimeZoneLabel(formatted, "local", date, timeZone);
}

export function formatAccountDate(
  value: Date | string,
  options: {
    locale: string;
    timezoneId?: AccountTimezoneId;
  } & Intl.DateTimeFormatOptions,
): string {
  const { locale, timezoneId = DEFAULT_ACCOUNT_TIMEZONE_ID, ...formatOptions } =
    options;
  const date = typeof value === "string" ? new Date(value) : value;
  const timeZone = resolveAccountTimeZoneIana(
    normalizeAccountTimezoneId(timezoneId),
  );
  const usesStyleOption =
    formatOptions.dateStyle !== undefined ||
    formatOptions.timeStyle !== undefined;

  return new Intl.DateTimeFormat(
    locale,
    usesStyleOption
      ? { timeZone, ...formatOptions }
      : {
          timeZone,
          month: "2-digit",
          day: "2-digit",
          year: "2-digit",
          ...formatOptions,
        },
  ).format(date);
}

/** Today's calendar date (YYYY-MM-DD) in the account timezone. */
export function accountTodayCalendarDate(
  timezoneId: AccountTimezoneId = DEFAULT_ACCOUNT_TIMEZONE_ID,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveAccountTimeZoneIana(
      normalizeAccountTimezoneId(timezoneId),
    ),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
