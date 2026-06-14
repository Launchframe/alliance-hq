/** Fixed UTC−02:00 — the game's "Server Time" (no daylight saving). */
export const SERVER_TIME_IANA = "Etc/GMT+2" as const;
export const SERVER_TIME_UTC_OFFSET = "-02:00";

export const DEFAULT_ACCOUNT_TIMEZONE_ID = "server" as const;

export type AccountTimezoneId = typeof DEFAULT_ACCOUNT_TIMEZONE_ID | string;
