import { shouldShowTeamAccessNav } from "@/lib/settings/team-access-nav.shared";

/** Sidebar visibility for /tools/video-processors (all alliance members). */
export function shouldShowVideoProcessorsNav(input: {
  allianceId: string | null;
  hasActiveMembership: boolean;
  isPlatformMaintainer: boolean;
}): boolean {
  return shouldShowTeamAccessNav(input);
}
