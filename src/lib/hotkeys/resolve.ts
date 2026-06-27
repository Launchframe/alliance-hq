import { DEFAULT_HOTKEY_BINDINGS } from "@/lib/hotkeys/defaults";
import { bindingSignature } from "@/lib/hotkeys/reserved";
import type {
  EffectiveHotkeyBinding,
  HotkeyBindingsPayload,
  HotkeyBindingsStore,
  HotkeyBinding,
} from "@/lib/hotkeys/types";
import { HOTKEY_BINDINGS_SCHEMA_VERSION } from "@/lib/hotkeys/types";

export function emptyHotkeyBindingsPayload(): HotkeyBindingsPayload {
  return {
    version: HOTKEY_BINDINGS_SCHEMA_VERSION,
    overrides: {},
  };
}

export function normalizeHotkeyBindingsPayload(
  raw: unknown,
): HotkeyBindingsPayload {
  if (!raw || typeof raw !== "object") {
    return emptyHotkeyBindingsPayload();
  }

  const value = raw as Partial<HotkeyBindingsPayload>;
  const overrides =
    value.overrides && typeof value.overrides === "object"
      ? (value.overrides as HotkeyBindingsStore)
      : {};

  return {
    version: HOTKEY_BINDINGS_SCHEMA_VERSION,
    overrides,
  };
}

export function resolveEffectiveBinding(
  actionId: string,
  overrides: HotkeyBindingsStore,
): EffectiveHotkeyBinding | null {
  const defaultBinding = DEFAULT_HOTKEY_BINDINGS[actionId];
  const override = overrides[actionId];

  if (!defaultBinding && !override) {
    return null;
  }

  return {
    actionId,
    binding: override?.binding ?? defaultBinding!,
    isOverride: Boolean(override),
    updatedAt: override?.updatedAt ?? null,
  };
}

export function resolveEffectiveBindings(
  overrides: HotkeyBindingsStore,
): EffectiveHotkeyBinding[] {
  const actionIds = new Set([
    ...Object.keys(DEFAULT_HOTKEY_BINDINGS),
    ...Object.keys(overrides),
  ]);

  return [...actionIds]
    .map((actionId) => resolveEffectiveBinding(actionId, overrides))
    .filter((entry): entry is EffectiveHotkeyBinding => entry !== null);
}

export function findBindingConflict(
  actionId: string,
  binding: HotkeyBinding,
  overrides: HotkeyBindingsStore,
): string | null {
  const signature = bindingSignature(binding);
  const effective = resolveEffectiveBindings(overrides);

  for (const entry of effective) {
    if (entry.actionId === actionId) continue;
    if (bindingSignature(entry.binding) === signature) {
      return entry.actionId;
    }
  }

  return null;
}

export function mergeHotkeyOverride(
  overrides: HotkeyBindingsStore,
  actionId: string,
  binding: HotkeyBinding,
): HotkeyBindingsStore {
  return {
    ...overrides,
    [actionId]: {
      binding,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function removeHotkeyOverride(
  overrides: HotkeyBindingsStore,
  actionId: string,
): HotkeyBindingsStore {
  const next = { ...overrides };
  delete next[actionId];
  return next;
}
