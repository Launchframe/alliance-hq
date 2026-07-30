/** 0 = green (low risk), 1 = red (high risk). */
export function riskIntensityColor(intensity: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  return `color-mix(in srgb, var(--hq-danger) ${Math.round(clamped * 100)}%, var(--hq-success))`;
}
