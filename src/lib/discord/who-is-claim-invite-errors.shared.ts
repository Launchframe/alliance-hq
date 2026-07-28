import type { CommanderClaimInviteErrorCode } from "@/lib/native-alliance/invites";

/** Discord bot i18n key for a commander claim invite failure. */
export function whoIsClaimInviteFailedMessageKey(
  code: CommanderClaimInviteErrorCode,
): string {
  switch (code) {
    case "commander_not_found":
      return "whoIs.claimInviteFailedCommanderNotFound";
    case "commander_already_claimed":
      return "whoIs.claimInviteFailedCommanderAlreadyClaimed";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
