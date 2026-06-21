/** Sidebar / settings hub visibility for /settings/team (not invite RBAC). */
export function shouldShowTeamAccessNav(input: {
  allianceId: string | null;
  hasActiveMembership: boolean;
  isPlatformMaintainer: boolean;
}): boolean {
  if (!input.allianceId) {
    return false;
  }
  return input.hasActiveMembership || input.isPlatformMaintainer;
}
