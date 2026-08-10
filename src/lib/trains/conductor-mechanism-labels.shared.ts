export function resolveConductorMechanismLabel(
  mechanism: string | null | undefined,
  labels: Record<string, string>,
): string | null {
  if (!mechanism) return null;
  return labels[mechanism] ?? mechanism;
}
