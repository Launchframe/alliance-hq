/** Message key under the `professions` namespace for a stored commander profession. */
export function professionLabelKey(
  profession: string | null | undefined,
): "wl" | "eng" | null {
  if (profession === "War Leader") return "wl";
  if (profession === "Engineer") return "eng";
  return null;
}

export function professionLevelDisplay(level: number | null | undefined): string {
  return level != null ? String(level) : "—";
}
