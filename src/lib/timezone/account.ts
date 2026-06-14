import {
  DEFAULT_ACCOUNT_TIMEZONE_ID,
  SERVER_TIME_IANA,
  type AccountTimezoneId,
} from "@/lib/timezone/constants";

export function normalizeAccountTimezoneId(
  stored: string | null | undefined,
): AccountTimezoneId {
  const trimmed = stored?.trim();
  if (!trimmed || trimmed === DEFAULT_ACCOUNT_TIMEZONE_ID) {
    return DEFAULT_ACCOUNT_TIMEZONE_ID;
  }
  return trimmed;
}

export function isValidIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidAccountTimezoneId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_ACCOUNT_TIMEZONE_ID) {
    return true;
  }
  return isValidIanaTimeZone(trimmed);
}

export function resolveAccountTimeZoneIana(
  timezoneId: AccountTimezoneId,
): string {
  if (timezoneId === DEFAULT_ACCOUNT_TIMEZONE_ID) {
    return SERVER_TIME_IANA;
  }
  return timezoneId;
}

export function isServerTime(timezoneId: AccountTimezoneId): boolean {
  return timezoneId === DEFAULT_ACCOUNT_TIMEZONE_ID;
}
