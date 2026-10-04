import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import type { CredentialShareCapability } from "@/lib/ashed/credential-share-capabilities.shared";
import {
  requireActiveShareCapability,
  resolveAshedConnectionForAlliance,
} from "@/lib/ashed/credential-share.server";
import { getAshedConnection } from "@/lib/session";

export async function loadAshedConnectionForAllianceCapability(input: {
  sessionId: string;
  allianceId: string;
  capability: CredentialShareCapability;
  delegatedAction: string;
}): Promise<ParsedConnection | null> {
  const resolved = await resolveAshedConnectionForAlliance(
    input.sessionId,
    input.allianceId,
  );
  if (!resolved) {
    return getAshedConnection(input.sessionId);
  }
  if (resolved.isDelegated) {
    const delegated = await requireActiveShareCapability({
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      capability: input.capability,
      delegatedAction: input.delegatedAction,
    });
    return delegated.connection;
  }
  return resolved.connection;
}
