import { NAV_GROUPS } from "@/lib/nav/routes";

const EXTRA_NATIVE_HQ_PREFIXES = [
  "/settings/team",
  "/account",
  "/profile",
  "/releases",
  "/admin",
] as const;

/** HQ-native routes that work without Ashed embeds — safe to keep on alliance switch. */
export function isNativeHqPath(pathname: string): boolean {
  const path = pathname.split("?")[0]?.split("#")[0] ?? pathname;

  if (
    EXTRA_NATIVE_HQ_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }

  return NAV_GROUPS.flatMap((group) => group.pages)
    .filter((page) => page.kind === "native")
    .some((page) => path === page.href || path.startsWith(`${page.href}/`));
}

export function resolveAllianceSwitchTargetPath(input: {
  currentPath: string;
  apiRedirectPath: string;
  /** When switching into an Ashed alliance, leave native-only HQ pages so the shell reloads with embed nav. */
  targetOperatingMode?: "ashed" | "native" | null;
}): string {
  if (
    input.targetOperatingMode === "ashed" &&
    isNativeHqPath(input.currentPath)
  ) {
    return input.apiRedirectPath;
  }

  if (isNativeHqPath(input.currentPath)) {
    return input.currentPath;
  }
  return input.apiRedirectPath;
}
