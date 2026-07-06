export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "alliance-hq-appearance-v1";

const PREFERENCE_VALUES: readonly AppearancePreference[] = [
  "system",
  "light",
  "dark",
];

export function isAppearancePreference(
  value: unknown,
): value is AppearancePreference {
  return (
    typeof value === "string" &&
    (PREFERENCE_VALUES as readonly string[]).includes(value)
  );
}

export function readStoredAppearancePreference(): AppearancePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return null;
    return isAppearancePreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredAppearancePreference(
  preference: AppearancePreference,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  prefersDark: boolean,
): ResolvedAppearance {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

export function applyResolvedAppearanceToDocument(
  resolved: ResolvedAppearance,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

/** Inline bootstrap script — must stay in sync with resolveAppearance(). */
export function buildAppearanceBootstrapScript(): string {
  return `
(function () {
  try {
    var key = ${JSON.stringify(APPEARANCE_STORAGE_KEY)};
    var pref = localStorage.getItem(key);
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = pref === "light" || pref === "dark"
      ? pref
      : (prefersDark ? "dark" : "light");
    var root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  } catch (e) {}
})();
`.trim();
}
