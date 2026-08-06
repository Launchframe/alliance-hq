import { eq } from "drizzle-orm";

import {
  acceptCredentialShare,
  CredentialShareError,
  findShareByPairingMetadata,
} from "@/lib/ashed/credential-share.server";
import { verifyBase44Connection } from "@/lib/base44/server";
import type { PairingStrategy } from "@/lib/credential-pairing/strategies/types";
import { PairingError } from "@/lib/credential-pairing/types";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection, loadSession, resolveEffectiveHqUserIdForSession } from "@/lib/session";

const INVITE_PAIRING_TTL_MINUTES = 72 * 60;

export const AUTHORIZED_ACCESS_PAIRING_TTL_MINUTES = INVITE_PAIRING_TTL_MINUTES;

export const authorizedAccessStrategy: PairingStrategy = {
  purpose: "authorized_access",

  async validateCreate({ sourceSession, metadata }) {
    if (!sourceSession.hqUserId || !sourceSession.currentAllianceId) {
      throw new PairingError(
        "Sign in and select your alliance before sharing credentials.",
        "FORBIDDEN",
      );
    }

    const shareId = metadata.shareId;
    if (typeof shareId !== "string" || !shareId.trim()) {
      throw new PairingError("Missing credential share.", "INVALID");
    }

    const connection = await getAshedConnection(sourceSession.id);
    if (!connection) {
      throw new PairingError(
        "Connect to Ashed before sharing credentials.",
        "NOT_CONNECTED",
      );
    }

    try {
      await verifyBase44Connection(connection);
    } catch {
      throw new PairingError(
        "Your Ashed connection expired. Reconnect and try again.",
        "TOKEN_EXPIRED",
      );
    }

    const db = getDb();
    const [share] = await db
      .select()
      .from(schema.ashedCredentialShares)
      .where(eq(schema.ashedCredentialShares.id, shareId))
      .limit(1);

    if (!share || share.status !== "pending") {
      throw new PairingError("This credential share is no longer pending.", "INVALID");
    }

    const effectiveOwnerHqUserId = await resolveEffectiveHqUserIdForSession(
      sourceSession.id,
      sourceSession.hqUserId,
    );
    if (
      !effectiveOwnerHqUserId ||
      share.ownerHqUserId !== effectiveOwnerHqUserId
    ) {
      throw new PairingError("Only the credential owner can share this invite.", "FORBIDDEN");
    }
  },

  async onComplete({ targetSessionId, metadata, completeOptions }) {
    const share = await findShareByPairingMetadata(metadata);
    if (!share) {
      throw new PairingError("This credential share invite is invalid.", "INVALID");
    }

    const targetSession = await loadSession(targetSessionId);
    if (!targetSession?.hqUserId) {
      throw new PairingError("Sign in before accepting credential access.", "FORBIDDEN");
    }

    try {
      await acceptCredentialShare({
        shareId: share.id,
        targetSessionId,
        acknowledged: completeOptions?.acknowledged === true,
      });
    } catch (error) {
      if (error instanceof CredentialShareError) {
        throw new PairingError(error.message, error.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID");
      }
      throw error;
    }
  },
};
