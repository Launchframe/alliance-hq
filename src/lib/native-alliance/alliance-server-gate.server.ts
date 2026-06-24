import "server-only";

import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";

export class AllianceServerRequiredError extends Error {
  readonly code = "alliance_server_required" as const;

  constructor() {
    super("Set your alliance state server in Settings before sending invites.");
    this.name = "AllianceServerRequiredError";
  }
}

export async function assertAllianceLinkedGameServer(
  allianceId: string,
): Promise<void> {
  const gameServerNumber = await resolveAllianceGameServerNumber(allianceId);
  if (gameServerNumber == null) {
    throw new AllianceServerRequiredError();
  }
}
