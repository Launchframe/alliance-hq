import {
  callerIsAllianceOfficerViaMemberLink,
  callerIsAllianceOwner,
} from "@/lib/vr/repository";

export async function callerCanRunVrReport(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  if (
    await callerIsAllianceOwner({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
    })
  ) {
    return true;
  }

  return callerIsAllianceOfficerViaMemberLink(input);
}
