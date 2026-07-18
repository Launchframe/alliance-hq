/**
 * Locale-aware formatters for chart axis labels shared by web SVG and Discord PNG.
 */

export type ChartLocale = string;

export function formatChartShortDate(
  iso: string,
  locale: ChartLocale = "en-US",
): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export function formatChartInteger(
  value: number,
  locale: ChartLocale = "en-US",
): string {
  return value.toLocaleString(locale);
}

/** Compact axis ticks (e.g. 1.2M / 54K) using the active locale. */
export function formatChartCompactNumber(
  value: number,
  locale: ChartLocale = "en-US",
): string {
  if (!Number.isFinite(value)) return String(value);
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
