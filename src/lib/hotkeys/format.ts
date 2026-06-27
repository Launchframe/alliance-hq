import type { HotkeyBinding, HotkeyModifier } from "@/lib/hotkeys/types";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function modifierLabel(modifier: HotkeyModifier): string {
  if (modifier === "meta") return isMacPlatform() ? "⌘" : "Ctrl";
  if (modifier === "ctrl") return "Ctrl";
  if (modifier === "alt") return isMacPlatform() ? "⌥" : "Alt";
  if (modifier === "shift") return "Shift";
  return modifier;
}

function keyLabel(key: string): string {
  if (key === "/") return "?";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatBindingLabels(binding: HotkeyBinding): string[] {
  if (binding.sequence?.length) {
    return binding.sequence.map((key) => keyLabel(key));
  }

  const labels: string[] = [];
  for (const modifier of binding.modifiers ?? []) {
    labels.push(modifierLabel(modifier));
  }
  if (binding.key) {
    labels.push(keyLabel(binding.key));
  }
  return labels;
}

export function formatBindingDisplay(binding: HotkeyBinding): string {
  if (binding.sequence?.length) {
    return binding.sequence.map((key) => keyLabel(key)).join(" then ");
  }

  const parts: string[] = [];
  for (const modifier of binding.modifiers ?? []) {
    parts.push(modifierLabel(modifier));
  }
  if (binding.key) {
    parts.push(keyLabel(binding.key));
  }
  return parts.join("+");
}
