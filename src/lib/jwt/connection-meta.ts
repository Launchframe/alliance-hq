import type { AshedCredential } from "@/lib/db/schema";
import {
  DEFAULT_EXPIRY_REMINDER_DAYS,
  formatTokenExpiryDate,
  getJwtExpiryDate,
  isTokenExpired,
  isWithinExpiryReminderWindow,
} from "@/lib/jwt/decode";

export type AshedConnectionMeta = {
  tokenExpiresAt: string | null;
  tokenExpiresAtFormatted: string | null;
  expiryReminderDays: number;
  showExpiryReminder: boolean;
  isTokenExpired: boolean;
};

export function buildAshedConnectionMeta(
  cred: Pick<
    AshedCredential,
    "tokenExpiresAt" | "expiryReminderDays"
  > | null,
  locale = "en-US",
): AshedConnectionMeta {
  if (!cred?.tokenExpiresAt) {
    return {
      tokenExpiresAt: null,
      tokenExpiresAtFormatted: null,
      expiryReminderDays: cred?.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS,
      showExpiryReminder: false,
      isTokenExpired: false,
    };
  }

  const expiresAt = cred.tokenExpiresAt;
  const reminderDays = cred.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS;
  const expired = isTokenExpired(expiresAt);

  return {
    tokenExpiresAt: expiresAt.toISOString(),
    tokenExpiresAtFormatted: formatTokenExpiryDate(expiresAt, locale),
    expiryReminderDays: reminderDays,
    showExpiryReminder:
      expired || isWithinExpiryReminderWindow(expiresAt, reminderDays),
    isTokenExpired: expired,
  };
}

export function resolveTokenExpiresAt(token: string): Date | null {
  return getJwtExpiryDate(token);
}
