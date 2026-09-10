export const TEAM_SETTINGS_TABS = [
  "invites",
  "processors",
  "credential-shares",
  "members",
] as const;

export type TeamSettingsTab = (typeof TEAM_SETTINGS_TABS)[number];

export function isTeamSettingsTab(
  value: string | null | undefined,
): value is TeamSettingsTab {
  return (
    value === "invites" ||
    value === "processors" ||
    value === "credential-shares" ||
    value === "members"
  );
}

/**
 * Resolve the active Team settings tab from a query param.
 * Unknown tabs and unauthorized tabs fall back to a visible tab.
 */
export function resolveTeamSettingsTab(
  raw: string | null | undefined,
  options: { canManageInvites: boolean; isAllianceAdmin: boolean },
): TeamSettingsTab {
  const tab = isTeamSettingsTab(raw) ? raw : "invites";

  if (tab === "invites" && !options.canManageInvites) {
    if (options.isAllianceAdmin) return "processors";
    return "members";
  }
  if (tab === "processors" && !options.isAllianceAdmin) {
    return options.canManageInvites ? "invites" : "members";
  }
  return tab;
}

export function teamSettingsHref(tab: TeamSettingsTab): string {
  return `/settings/team?tab=${tab}`;
}
