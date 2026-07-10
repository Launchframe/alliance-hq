import type { BattlePlanMarkerNumber } from "@/lib/battle-plan/types.shared";

export const DEFAULT_MARKER_COLORS: Record<BattlePlanMarkerNumber, string> = {
  1: "#ef4444",
  2: "#3b82f6",
  3: "#22c55e",
  4: "#f59e0b",
  5: "#a855f7",
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isMarkerColorHex(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

export function resolveMarkerColorHex(
  markerNumber: BattlePlanMarkerNumber,
  storedColorHex: string | null | undefined,
): string {
  if (storedColorHex && isMarkerColorHex(storedColorHex)) {
    return storedColorHex.toLowerCase();
  }
  return DEFAULT_MARKER_COLORS[markerNumber];
}

export function capturePolicyBarClassName(policy: "peace" | "war"): string {
  return policy === "peace"
    ? "bg-blue-600 text-white"
    : "bg-red-600 text-white";
}
