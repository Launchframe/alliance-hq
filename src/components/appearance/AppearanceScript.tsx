import {
  APPEARANCE_STORAGE_KEY,
  type ResolvedAppearance,
} from "@/lib/appearance/appearance.shared";

/** Inline script that runs before paint to avoid a light/dark flash. */
export function AppearanceScript() {
  const script = `
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

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}

export function resolvedAppearanceThemeColor(
  resolved: ResolvedAppearance,
): string {
  return resolved === "dark" ? "#0d1117" : "#ffffff";
}
