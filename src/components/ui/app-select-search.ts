import { stringSimilarity } from "@/lib/video/member-matcher";

import type { AppSelectOption } from "./AppSelect";

export function appSelectOptionSearchText(option: AppSelectOption): string {
  if (option.searchText?.trim()) {
    return option.searchText.trim();
  }
  return typeof option.label === "string" ? option.label : "";
}

/** Case-insensitive substring match for searchable AppSelect menus. */
export function appSelectOptionMatchesQuery(
  option: AppSelectOption,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return appSelectOptionSearchText(option).toLowerCase().includes(needle);
}

/** Fuzzy similarity score in [0, 1] for ranking AppSelect options. */
export function appSelectOptionFuzzyScore(
  option: AppSelectOption,
  query: string,
): number {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return 1;
  }
  const haystack = appSelectOptionSearchText(option).toLowerCase();
  if (!haystack) {
    return 0;
  }
  if (haystack.includes(needle)) {
    return 1;
  }

  let best = stringSimilarity(needle, haystack);
  for (const token of haystack.split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith(needle)) {
      best = Math.max(best, 0.95);
    }
    best = Math.max(best, stringSimilarity(needle, token));
  }
  return best;
}

export const APP_SELECT_FUZZY_MIN_SCORE = 0.45;

export type AppSelectSearchMode = "substring" | "fuzzy";

export function filterAppSelectOptions(
  options: AppSelectOption[],
  query: string,
  mode: AppSelectSearchMode,
  hideEmptyOnQuery = false,
): AppSelectOption[] {
  if (!query.trim()) {
    return options;
  }

  const emptyOptions = options.filter((option) => option.value === "");
  const rest = options.filter((option) => option.value !== "");
  const prefix =
    hideEmptyOnQuery || emptyOptions.length === 0 ? [] : emptyOptions;

  if (mode === "substring") {
    const filtered = rest.filter((option) =>
      appSelectOptionMatchesQuery(option, query),
    );
    return [...prefix, ...filtered];
  }

  const scored = rest
    .map((option) => ({
      option,
      score: appSelectOptionFuzzyScore(option, query),
    }))
    .filter((row) => row.score >= APP_SELECT_FUZZY_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  return [...prefix, ...scored.map((row) => row.option)];
}
