import { normalizeHotkeyKey } from "@/lib/hotkeys/reserved";
import type { HotkeyBinding, HotkeyModifier } from "@/lib/hotkeys/types";

export const HOTKEY_SEQUENCE_TIMEOUT_MS = 1500;

export type ParsedKeyboardEvent = {
  key: string;
  modifiers: HotkeyModifier[];
};

export function readModifiers(event: KeyboardEvent): HotkeyModifier[] {
  const modifiers: HotkeyModifier[] = [];
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");
  if (event.ctrlKey) modifiers.push("ctrl");
  return modifiers.sort();
}

export function parseKeyboardEvent(event: KeyboardEvent): ParsedKeyboardEvent {
  return {
    key: normalizeHotkeyKey(event.key),
    modifiers: readModifiers(event),
  };
}

function modifiersEqual(
  left: HotkeyModifier[] | undefined,
  right: HotkeyModifier[],
): boolean {
  const a = [...(left ?? [])].sort();
  const b = [...right].sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function chordMatchesEvent(
  binding: HotkeyBinding,
  event: ParsedKeyboardEvent,
): boolean {
  if (!binding.key || binding.sequence?.length) return false;
  return (
    normalizeHotkeyKey(binding.key) === event.key &&
    modifiersEqual(binding.modifiers, event.modifiers)
  );
}

export function bindingMatchesEvent(
  binding: HotkeyBinding,
  event: ParsedKeyboardEvent,
): boolean {
  return chordMatchesEvent(binding, event);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return Boolean(target.closest("[data-hotkey-ignore]"));
}

export function shouldIgnoreHotkeysForEvent(
  event: KeyboardEvent,
  options: {
    paletteOpen?: boolean;
    allowPaletteChord?: boolean;
  } = {},
): boolean {
  if (options.paletteOpen) {
    return false;
  }

  if (isTypingTarget(event.target)) {
    const parsed = parseKeyboardEvent(event);
    const isPaletteChord =
      options.allowPaletteChord &&
      parsed.key === "k" &&
      (parsed.modifiers.includes("meta") || parsed.modifiers.includes("ctrl"));
    return !isPaletteChord;
  }

  return false;
}

export type SequenceState = {
  keys: string[];
  startedAt: number;
};

export function createSequenceState(): SequenceState {
  return { keys: [], startedAt: 0 };
}

export function advanceSequenceState(
  state: SequenceState,
  event: ParsedKeyboardEvent,
  now = Date.now(),
): SequenceState {
  if (
    state.keys.length > 0 &&
    now - state.startedAt > HOTKEY_SEQUENCE_TIMEOUT_MS
  ) {
    state = createSequenceState();
  }

  if (event.modifiers.length > 0) {
    return createSequenceState();
  }

  if (state.keys.length === 0) {
    return {
      keys: [event.key],
      startedAt: now,
    };
  }

  return {
    keys: [...state.keys, event.key],
    startedAt: state.startedAt,
  };
}

export function sequenceMatchesBinding(
  binding: HotkeyBinding,
  keys: string[],
): boolean {
  if (!binding.sequence?.length) return false;
  if (binding.sequence.length !== keys.length) return false;
  return binding.sequence.every(
    (key, index) => normalizeHotkeyKey(key) === keys[index],
  );
}

export function findMatchingActionId(
  bindings: Array<{ actionId: string; binding: HotkeyBinding }>,
  event: ParsedKeyboardEvent,
  sequenceKeys: string[],
): string | null {
  for (const entry of bindings) {
    if (chordMatchesEvent(entry.binding, event)) {
      return entry.actionId;
    }
  }

  for (const entry of bindings) {
    if (sequenceMatchesBinding(entry.binding, sequenceKeys)) {
      return entry.actionId;
    }
  }

  return null;
}
