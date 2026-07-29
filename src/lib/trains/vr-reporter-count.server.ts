import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { countAllianceSeasonVrReporters } from "@/lib/vr/repository";

/**
 * Active-roster season VR reporters eligible for the Top VR wheel.
 *
 * Must stay aligned with `fetchNativeVrTopScorers` (open membership ∩
 * `alliance_members.status != former` ∩ non-empty name ∩ `highest_base_vr > 0`)
 * so scope unlock (`reporterCount >= 2×N`) cannot pass while the wheel board
 * is shorter than N.
 */
export async function countAllianceVrReporters(
  allianceId: string,
): Promise<number> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(allianceId);
  return countAllianceSeasonVrReporters(allianceId, seasonKey);
}
