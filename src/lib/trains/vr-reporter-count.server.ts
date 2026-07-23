import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { listAllianceSeasonVrForLeaderboard } from "@/lib/vr/repository";

/** Active season VR reporters (`highest_base_vr > 0`) for Top VR scope locks. */
export async function countAllianceVrReporters(
  allianceId: string,
): Promise<number> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(allianceId);
  const rows = await listAllianceSeasonVrForLeaderboard(allianceId, seasonKey);
  let count = 0;
  for (const row of rows) {
    if (row.highestBaseVr > 0) count += 1;
  }
  return count;
}
