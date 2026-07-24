import type { AppSelectOption } from "./AppSelect";
import { appSelectOptionSearchText } from "./app-select-search";

/** Matches common native `<select>` typeahead reset timing. */
export const APP_SELECT_TYPEAHEAD_RESET_MS = 600;

export function isAppSelectTypeaheadKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1;
}

export function appendAppSelectTypeaheadBuffer(
  previousBuffer: string,
  key: string,
  elapsedMs: number,
): { buffer: string; cycleOnly: boolean } {
  const ch = key.toLowerCase();
  if (!ch) {
    return { buffer: previousBuffer, cycleOnly: false };
  }
  if (elapsedMs > APP_SELECT_TYPEAHEAD_RESET_MS || !previousBuffer) {
    return { buffer: ch, cycleOnly: false };
  }
  if (previousBuffer.length === 1 && previousBuffer === ch) {
    return { buffer: previousBuffer, cycleOnly: true };
  }
  return { buffer: `${previousBuffer}${ch}`, cycleOnly: false };
}

/** Index into `enabledOptions` for the next typeahead match. */
export function findEnabledAppSelectTypeaheadIndex(
  enabledOptions: readonly AppSelectOption[],
  buffer: string,
  activeIndex: number,
): number {
  const needle = buffer.trim().toLowerCase();
  if (!needle || enabledOptions.length === 0) return -1;

  const matches: number[] = [];
  for (let index = 0; index < enabledOptions.length; index++) {
    const text = appSelectOptionSearchText(enabledOptions[index]!).toLowerCase();
    if (text.startsWith(needle)) {
      matches.push(index);
    }
  }
  if (matches.length === 0) return -1;

  if (needle.length === 1) {
    const currentPos = matches.indexOf(activeIndex);
    if (currentPos >= 0 && matches.length > 1) {
      return matches[(currentPos + 1) % matches.length]!;
    }
  }

  return matches[0]!;
}
