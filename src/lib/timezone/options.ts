import { DEFAULT_ACCOUNT_TIMEZONE_ID } from "@/lib/timezone/constants";

/** Curated IANA zones shown after Server Time in settings. */
export const ACCOUNT_TIMEZONE_OPTION_IDS = [
  DEFAULT_ACCOUNT_TIMEZONE_ID,
  "UTC",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

export type AccountTimezoneOptionId =
  (typeof ACCOUNT_TIMEZONE_OPTION_IDS)[number];

export function formatTimezoneOptionLabel(
  timezoneId: string,
  locale: string,
  serverTimeLabel: string,
): string {
  if (timezoneId === DEFAULT_ACCOUNT_TIMEZONE_ID) {
    return serverTimeLabel;
  }

  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezoneId,
      timeZoneName: "longGeneric",
    });
    const parts = formatter.formatToParts(new Date());
    const zoneName =
      parts.find((part) => part.type === "timeZoneName")?.value ?? timezoneId;
    return `${zoneName} (${timezoneId})`;
  } catch {
    return timezoneId;
  }
}
