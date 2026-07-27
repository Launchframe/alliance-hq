import {
  HOTKEY_ACTIONS,
  HOTKEY_ACTIONS_BY_ID,
  type HotkeyActionId,
} from "@/lib/hotkeys/actions.registry";
import { DEFAULT_HOTKEY_BINDINGS } from "@/lib/hotkeys/defaults";
import type { HotkeyBindingsStore } from "@/lib/hotkeys/types";

export type { HotkeyActionId };

export function isKnownHotkeyActionId(actionId: string): actionId is HotkeyActionId {
  return HOTKEY_ACTIONS_BY_ID.has(actionId);
}

/** Drop stale override keys from DB that no longer exist in the registry. */
export function sanitizeHotkeyOverrides(
  overrides: HotkeyBindingsStore,
): HotkeyBindingsStore {
  const next: HotkeyBindingsStore = {};
  for (const [actionId, entry] of Object.entries(overrides)) {
    if (isKnownHotkeyActionId(actionId)) {
      next[actionId] = entry;
    }
  }
  return next;
}

export type HotkeyRegistryIntegrityReport = {
  missingDefaults: string[];
  orphanDefaults: string[];
  /** Shorter default sequences that are prefixes of longer ones (unreachable longer binding). */
  sequencePrefixConflicts: string[];
};

function sequencePrefixKey(sequence: string[]): string {
  return sequence.map((key) => key.toLowerCase()).join(">");
}

/**
 * Exact-length sequence matching fires as soon as keys match, so a default like
 * `g>t` makes any `g>t>…` extension unreachable. Catch that at integrity time.
 */
export function findDefaultSequencePrefixConflicts(): string[] {
  const sequences = Object.entries(DEFAULT_HOTKEY_BINDINGS)
    .map(([actionId, binding]) => ({
      actionId,
      sequence: binding.sequence ?? [],
    }))
    .filter((row) => row.sequence.length > 0);

  const conflicts: string[] = [];
  for (const shorter of sequences) {
    for (const longer of sequences) {
      if (longer.sequence.length <= shorter.sequence.length) continue;
      const isPrefix = shorter.sequence.every(
        (key, index) =>
          key.toLowerCase() === longer.sequence[index]?.toLowerCase(),
      );
      if (!isPrefix) continue;
      conflicts.push(
        `${shorter.actionId} (${sequencePrefixKey(shorter.sequence)}) prefixes ${longer.actionId} (${sequencePrefixKey(longer.sequence)})`,
      );
    }
  }
  return conflicts.sort();
}

export function checkHotkeyRegistryIntegrity(): HotkeyRegistryIntegrityReport {
  const registryIds = new Set(HOTKEY_ACTIONS.map((action) => action.id));
  const defaultIds = new Set(Object.keys(DEFAULT_HOTKEY_BINDINGS));

  const missingDefaults = [...registryIds].filter((id) => !defaultIds.has(id));
  const orphanDefaults = [...defaultIds].filter((id) => !registryIds.has(id));
  const sequencePrefixConflicts = findDefaultSequencePrefixConflicts();

  return { missingDefaults, orphanDefaults, sequencePrefixConflicts };
}

export function assertHotkeyRegistryIntegrity(): void {
  const { missingDefaults, orphanDefaults, sequencePrefixConflicts } =
    checkHotkeyRegistryIntegrity();
  if (
    missingDefaults.length > 0 ||
    orphanDefaults.length > 0 ||
    sequencePrefixConflicts.length > 0
  ) {
    throw new Error(
      [
        missingDefaults.length > 0
          ? `Hotkey actions missing defaults: ${missingDefaults.join(", ")}`
          : null,
        orphanDefaults.length > 0
          ? `Hotkey defaults without registry actions: ${orphanDefaults.join(", ")}`
          : null,
        sequencePrefixConflicts.length > 0
          ? `Hotkey default sequence prefix conflicts: ${sequencePrefixConflicts.join("; ")}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}
