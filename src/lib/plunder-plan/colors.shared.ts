export const PLAN_PALETTE = {
  blue: "#2563EB", teal: "#0D9488", green: "#16A34A", amber: "#D97706", orange: "#EA580C", red: "#DC2626", pink: "#DB2777", purple: "#9333EA", slate: "#64748B",
} as const;
export type PlanColorName = keyof typeof PLAN_PALETTE;

export function parsePlanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (Object.hasOwn(PLAN_PALETTE, value)) return PLAN_PALETTE[value as PlanColorName];
  return /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

export function colorLuminance(color: string): number {
  const parsed = parsePlanColor(color);
  if (!parsed) throw new Error("invalidColor");
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(parsed.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function planColorStyle(color: string): { backgroundColor: string; color: string; borderColor: string } {
  const parsed = parsePlanColor(color) ?? PLAN_PALETTE.blue;
  const light = colorLuminance(parsed);
  const foreground = (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? "#000000" : "#FFFFFF";
  return { backgroundColor: parsed, color: foreground, borderColor: foreground };
}

export function defaultPlanColor(principalId: string): string {
  let hash = 0;
  for (const char of principalId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const colors = Object.values(PLAN_PALETTE);
  return colors[hash % colors.length];
}
