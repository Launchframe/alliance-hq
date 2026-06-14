/** Decode JWT payload (no signature verification — display/metadata only). */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );

  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }

  return atob(padded);
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const json = base64UrlDecode(parts[1]);
    const payload = JSON.parse(json) as Record<string, unknown>;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function getJwtExpiryDate(token: string): Date | null {
  const payload = decodeJwtPayload(token);
  if (!payload || !("exp" in payload)) {
    return null;
  }

  const exp = payload.exp;
  if (typeof exp === "number" && Number.isFinite(exp)) {
    return new Date(exp * 1000);
  }

  if (typeof exp === "string" && /^\d+$/.test(exp)) {
    return new Date(Number(exp) * 1000);
  }

  return null;
}

export function formatTokenExpiryDate(date: Date, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export const DEFAULT_EXPIRY_REMINDER_DAYS = 14;

export function daysUntil(date: Date, from = new Date()): number {
  const ms = date.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isTokenExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function isWithinExpiryReminderWindow(
  expiresAt: Date,
  reminderDays: number,
  now = new Date(),
): boolean {
  if (isTokenExpired(expiresAt, now)) {
    return true;
  }
  return daysUntil(expiresAt, now) <= reminderDays;
}
