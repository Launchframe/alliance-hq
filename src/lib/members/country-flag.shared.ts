/** LastRank stores ISO-ish region codes on commanders (`lastrank_country`). */

const REGION_CODE_RE = /^[A-Z]{2}$/;

const REGION_ALIASES: Record<string, string> = {
  UK: "GB",
};

export function normalizeIsoCountryCode(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const mapped = REGION_ALIASES[trimmed] ?? trimmed;
  if (!REGION_CODE_RE.test(mapped)) return null;
  return mapped;
}

export function isoCountryFlagEmoji(code: string): string {
  const regionalA = 0x1f1e6;
  return String.fromCodePoint(
    ...[...code].map((ch) => regionalA + (ch.charCodeAt(0) - 65)),
  );
}

export function countryDisplayName(
  code: string,
  locale: string,
): string | null {
  try {
    const name = new Intl.DisplayNames([locale], { type: "region" }).of(code);
    if (!name || name.toUpperCase() === code) return null;
    return name;
  } catch {
    return null;
  }
}

export function countryFlagParts(
  raw: string | null | undefined,
  locale: string,
): { code: string; emoji: string; name: string } | null {
  const code = normalizeIsoCountryCode(raw);
  if (!code) return null;
  const name = countryDisplayName(code, locale);
  if (!name) return null;
  return { code, emoji: isoCountryFlagEmoji(code), name };
}
