export type RelativeDurationParts = {
  days: number;
  hours: number;
  minutes: number;
};

/** Left-pad typed digits to DDHHMM for parsing (e.g. "130" → 0d 1h 30m). */
export function parseRelativeDurationDigits(
  digits: string,
): RelativeDurationParts {
  const padded = digits.replace(/\D/g, "").slice(0, 6).padStart(6, "0");
  return {
    days: Number(padded.slice(0, 2)),
    hours: Number(padded.slice(2, 4)),
    minutes: Number(padded.slice(4, 6)),
  };
}

export function relativeDurationPartsToTotalMinutes(
  parts: RelativeDurationParts,
): number {
  return parts.days * 24 * 60 + parts.hours * 60 + parts.minutes;
}

export function relativeDurationDigitsToIso(
  digits: string,
  now = new Date(),
): string {
  const totalMinutes = relativeDurationPartsToTotalMinutes(
    parseRelativeDurationDigits(digits),
  );
  return new Date(now.getTime() + totalMinutes * 60_000).toISOString();
}

export function isoToRelativeDurationDigits(
  iso: string,
  now = new Date(),
): string {
  const diffMs = Math.max(0, new Date(iso).getTime() - now.getTime());
  const totalMinutes = Math.round(diffMs / 60_000);
  const days = Math.min(99, Math.floor(totalMinutes / (24 * 60)));
  const remainder = totalMinutes - days * 24 * 60;
  const hours = Math.floor(remainder / 60);
  const minutes = remainder % 60;
  return `${String(days).padStart(2, "0")}${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}`;
}
