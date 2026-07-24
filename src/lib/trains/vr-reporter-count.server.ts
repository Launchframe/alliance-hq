import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { countAllianceSeasonVrReporters } from "@/lib/vr/repository";

/** Active season VR reporters (`highest_base_vr > 0`) for Top VR scope locks. */
export async function countAllianceVrReporters(
  allianceId: string,
): Promise<number> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(allianceId);
  return countAllianceSeasonVrReporters(allianceId, seasonKey);
}
