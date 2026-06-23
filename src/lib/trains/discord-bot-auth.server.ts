import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";

/** Discord train mutations: alliance owner or linked R4+ commander (same as VR reports). */
export async function callerCanManageTrains(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  return callerCanRunVrReport(input);
}
