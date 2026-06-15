import { eq } from "drizzle-orm";

import { verifyBase44Connection } from "@/lib/base44/server";
import { copyEncryptedCredentialsToSession } from "@/lib/credential-pairing/copy-credentials";
import type { PairingStrategy } from "@/lib/credential-pairing/strategies/types";
import { registerLinkedDevice } from "@/lib/credential-pairing/linked-devices";
import { PairingError } from "@/lib/credential-pairing/types";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection, loadSession } from "@/lib/session";

export const deviceLinkStrategy: PairingStrategy = {
  purpose: "device_link",

  async validateCreate({ sourceSession }) {
    if (!sourceSession.hqUserId) {
      throw new PairingError(
        "Reconnect on your desktop before linking a mobile device.",
        "NOT_CONNECTED",
      );
    }

    const connection = await getAshedConnection(sourceSession.id);
    if (!connection) {
      throw new PairingError(
        "Connect to Ashed before linking a mobile device.",
        "NOT_CONNECTED",
      );
    }
  },

  async onComplete({ sourceSession, targetSessionId, pairingCodeId, clientInfo }) {
    if (!sourceSession.hqUserId) {
      throw new PairingError(
        "Reconnect on your desktop before linking a mobile device.",
        "NOT_CONNECTED",
      );
    }

    const connection = await getAshedConnection(sourceSession.id);
    if (!connection) {
      throw new PairingError(
        "The desktop connection is no longer available. Try again from Settings.",
        "NOT_CONNECTED",
      );
    }

    try {
      await verifyBase44Connection(connection);
    } catch {
      throw new PairingError(
        "The connection key expired. Reconnect on your desktop and try again.",
        "TOKEN_EXPIRED",
      );
    }

    await copyEncryptedCredentialsToSession(sourceSession.id, targetSessionId);

    const db = getDb();
    await db
      .update(schema.sessions)
      .set({
        userLabel: sourceSession.userLabel,
        allianceId: sourceSession.allianceId,
        allianceTag: sourceSession.allianceTag,
        hqUserId: sourceSession.hqUserId,
        currentAllianceId: sourceSession.currentAllianceId,
        updatedAt: new Date(),
      })
      .where(eq(schema.sessions.id, targetSessionId));

    await registerLinkedDevice({
      hqUserId: sourceSession.hqUserId,
      sessionId: targetSessionId,
      pairingCodeId,
      userAgent: clientInfo?.userAgent,
    });
  },
};

export async function loadSourceSessionForPairing(
  sessionId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof loadSession>>>> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new PairingError("Invalid pairing session.", "INVALID");
  }
  return session;
}
