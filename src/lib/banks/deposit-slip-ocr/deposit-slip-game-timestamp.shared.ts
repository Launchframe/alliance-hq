import type { DepositSlipTimePendingDate } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";

/** Parsed-row powerLevel sentinel when only time-of-day survived OCR date garbling. */
export const DEPOSIT_AT_PENDING_POWER_LEVEL_PREFIX = "pending:" as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Store full depositAt or a pending time-only token for parsed_rows.powerLevel. */
export function encodeDepositAtForParsedRow(input: {
  depositAt: string | null;
  depositAtTimePendingDate?: DepositSlipTimePendingDate | null;
}): string | null {
  if (input.depositAt?.trim()) return input.depositAt;
  const pending = input.depositAtTimePendingDate;
  if (!pending) return null;
  return `${DEPOSIT_AT_PENDING_POWER_LEVEL_PREFIX}${pad2(pending.hour)}:${pad2(pending.minute)}:${pad2(pending.second)}`;
}

export function decodeDepositAtPowerLevel(powerLevel: string | null | undefined): {
  depositAt: string | null;
  depositAtTimePendingDate?: DepositSlipTimePendingDate;
} {
  const trimmed = powerLevel?.trim() ?? "";
  if (!trimmed) {
    return { depositAt: null };
  }
  if (trimmed.startsWith(DEPOSIT_AT_PENDING_POWER_LEVEL_PREFIX)) {
    const time = trimmed.slice(DEPOSIT_AT_PENDING_POWER_LEVEL_PREFIX.length);
    const match = time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return { depositAt: null };
    }
    return {
      depositAt: null,
      depositAtTimePendingDate: {
        hour: Number(match[1]),
        minute: Number(match[2]),
        second: Number(match[3]),
        round: "none",
      },
    };
  }
  return { depositAt: trimmed };
}

/** Game-server wall clock for deposit-slip review summaries (24h, unpadded month/day). */
export function formatDepositSlipGameTimestamp(
  iso: string | null | undefined,
): string {
  if (!iso) return "—";
  if (iso.startsWith(DEPOSIT_AT_PENDING_POWER_LEVEL_PREFIX)) {
    const time = iso.slice(DEPOSIT_AT_PENDING_POWER_LEVEL_PREFIX.length);
    return time || "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}
