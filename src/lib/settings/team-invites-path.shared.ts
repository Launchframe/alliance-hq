import { teamSettingsHref } from "@/lib/settings/team-settings-tabs.shared";

/** Scroll target on the Invites panel for commander claim invite deep links. */
export const COMMANDER_CLAIM_INVITES_ANCHOR = "commander-claim-invites";

export function commanderClaimInvitesSettingsPath(): string {
  return `${teamSettingsHref("invites")}#${COMMANDER_CLAIM_INVITES_ANCHOR}`;
}
