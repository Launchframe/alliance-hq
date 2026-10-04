import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import { base44EntityPut } from "@/lib/base44/fetch";
import {
  buildDesertStormMatchAshedPatch,
  desertStormMatchHasOfficerInput,
  type DesertStormMatchHeader,
  type DesertStormStormTeam,
} from "@/lib/video/desert-storm-match-header.shared";

/** PUT DesertStormEvent opponent + result for the selected HQ team row. */
export async function updateAshedDesertStormMatch(params: {
  connection: ParsedConnection;
  eventId: string;
  team: DesertStormStormTeam;
  header: DesertStormMatchHeader;
}): Promise<boolean> {
  if (!desertStormMatchHasOfficerInput(params.header)) {
    return false;
  }
  const patch = buildDesertStormMatchAshedPatch(params.team, params.header);
  await base44EntityPut(
    params.connection,
    "DesertStormEvent",
    params.eventId,
    patch,
  );
  return true;
}
