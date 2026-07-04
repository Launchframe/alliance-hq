import { buildConnectHref } from "@/lib/connect/connect-return-path.shared";
import type { AllianceSetupGuideTaskId } from "@/lib/alliance-setup-guide-status.shared";

/**
 * Destination for a setup-guide task's primary action. Shared by the settings
 * section and the dashboard banner so the two surfaces never drift.
 */
export function allianceSetupGuideTaskHref(
  id: AllianceSetupGuideTaskId,
  returnPath?: string | null,
): string | null {
  switch (id) {
    case "connect_ashed":
      return buildConnectHref(returnPath);
    case "roster_hardening":
    case "roster_populated":
      return "/members";
    case "game_server":
      return "/settings";
    case "owner_commander_link":
      return "/onboard";
    case "team_invites":
      return "/settings/team";
    case "discord_guild":
      return "/guides/discord-train";
    default:
      return null;
  }
}
