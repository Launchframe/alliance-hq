/** Debounce before clearing navigation activity after pathname settles. */
export const NAVIGATION_COMPLETE_DEBOUNCE_MS = 120;

export type NavigationReason = "route" | "locale" | "refresh" | "session";

export type SessionChangeReason =
  | "signOut"
  | "connect"
  | "invite"
  | "joinCode"
  | "memberLink";

export function pathsMatchForNavigation(
  localizedTarget: string,
  currentPathname: string,
  logicalTarget: string,
  logicalCurrent: string,
): boolean {
  return (
    localizedTarget === currentPathname ||
    logicalTarget === logicalCurrent
  );
}
