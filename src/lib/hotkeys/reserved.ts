import type { HotkeyBinding, HotkeyModifier } from "@/lib/hotkeys/types";

const RESERVED_SINGLE_KEYS = new Set([
  "Tab",
  "Enter",
  "Escape",
  "F5",
  "F12",
]);

const RESERVED_CHORDS: Array<{ modifiers: HotkeyModifier[]; key: string }> = [
  { modifiers: ["meta"], key: "t" },
  { modifiers: ["meta"], key: "w" },
  { modifiers: ["meta"], key: "n" },
  { modifiers: ["meta"], key: "r" },
  { modifiers: ["meta"], key: "l" },
  { modifiers: ["meta"], key: "p" },
  { modifiers: ["meta", "shift"], key: "t" },
  { modifiers: ["ctrl"], key: "t" },
  { modifiers: ["ctrl"], key: "w" },
  { modifiers: ["ctrl"], key: "n" },
  { modifiers: ["ctrl"], key: "r" },
  { modifiers: ["ctrl"], key: "l" },
  { modifiers: ["ctrl"], key: "p" },
  { modifiers: ["ctrl", "shift"], key: "t" },
];

function normalizeModifiers(modifiers: HotkeyModifier[] | undefined): HotkeyModifier[] {
  return [...(modifiers ?? [])].sort();
}

function modifiersMatch(
  a: HotkeyModifier[] | undefined,
  b: HotkeyModifier[],
): boolean {
  const left = normalizeModifiers(a);
  if (left.length !== b.length) return false;
  return left.every((value, index) => value === b[index]);
}

export function normalizeHotkeyKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  if (key === "?") return "/";
  return key;
}

export function bindingSignature(binding: HotkeyBinding): string {
  if (binding.sequence?.length) {
    return `seq:${binding.sequence.map(normalizeHotkeyKey).join(">")}`;
  }
  const mods = normalizeModifiers(binding.modifiers).join("+");
  const key = binding.key ? normalizeHotkeyKey(binding.key) : "";
  return `chord:${mods}:${key}`;
}

export function isReservedBinding(binding: HotkeyBinding): boolean {
  if (binding.sequence?.length) {
    return binding.sequence.some((key) => RESERVED_SINGLE_KEYS.has(key));
  }

  const key = binding.key ? normalizeHotkeyKey(binding.key) : "";
  if (!key) return true;
  if (RESERVED_SINGLE_KEYS.has(key)) return true;

  const modifiers = binding.modifiers ?? [];
  if (modifiers.length === 0) {
    return false;
  }

  return RESERVED_CHORDS.some(
    (reserved) =>
      reserved.key === key && modifiersMatch(modifiers, reserved.modifiers),
  );
}

export function validateHotkeyBinding(binding: HotkeyBinding): string | null {
  const hasSequence = Boolean(binding.sequence?.length);
  const hasChord = Boolean(binding.key);

  if (hasSequence && hasChord) {
    return "Binding cannot combine a chord and a sequence.";
  }
  if (!hasSequence && !hasChord) {
    return "Binding must include a key or sequence.";
  }

  if (hasSequence) {
    if ((binding.sequence?.length ?? 0) < 2) {
      return "Sequences need at least two keys.";
    }
    if (binding.modifiers?.length) {
      return "Sequences cannot include modifier keys.";
    }
  }

  if (isReservedBinding(binding)) {
    return "That shortcut is reserved by the browser or operating system.";
  }

  return null;
}
