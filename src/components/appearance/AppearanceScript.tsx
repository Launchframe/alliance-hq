import {
  buildAppearanceBootstrapScript,
  type ResolvedAppearance,
} from "@/lib/appearance/appearance.shared";

/** Inline script that runs before paint to avoid a light/dark flash. */
export function AppearanceScript() {
  const script = buildAppearanceBootstrapScript();

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
