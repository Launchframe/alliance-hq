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
};

export function checkHotkeyRegistryIntegrity(): HotkeyRegistryIntegrityReport {
  const registryIds = new Set(HOTKEY_ACTIONS.map((action) => action.id));
  const defaultIds = new Set(Object.keys(DEFAULT_HOTKEY_BINDINGS));

  const missingDefaults = [...registryIds].filter((id) => !defaultIds.has(id));
  const orphanDefaults = [...defaultIds].filter((id) => !registryIds.has(id));

  return { missingDefaults, orphanDefaults };
}

export function assertHotkeyRegistryIntegrity(): void {
  const { missingDefaults, orphanDefaults } = checkHotkeyRegistryIntegrity();
  if (missingDefaults.length > 0 || orphanDefaults.length > 0) {
    throw new Error(
      [
        missingDefaults.length > 0
          ? `Hotkey actions missing defaults: ${missingDefaults.join(", ")}`
          : null,
        orphanDefaults.length > 0
          ? `Hotkey defaults without registry actions: ${orphanDefaults.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}
