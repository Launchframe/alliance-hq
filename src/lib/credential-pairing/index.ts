import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { resolveAppOrigin } from "@/lib/app-origin";
import { getPairingStrategy } from "@/lib/credential-pairing/strategies";
import {
  type CreatePairingOptions,
  type PairingClientInfo,
  type PairingCompleteResult,
  type PairingCreateResult,
  PairingError,
  type PairingMetadata,
  PAIRING_PURPOSES,
  type PairingPurpose,
  type PairingStatus,
} from "@/lib/credential-pairing/types";
import { getDb, schema } from "@/lib/db";
import { loadSession } from "@/lib/session";

const DEFAULT_TTL_MINUTES = 5;

export function isPairingPurpose(value: string): value is PairingPurpose {
  return (PAIRING_PURPOSES as readonly string[]).includes(value);
}

export function buildPairingUrl(code: string, locale?: string): string {
  const origin = resolveAppOrigin();
  const localePrefix =
    locale && locale !== "en-US" ? `/${encodeURIComponent(locale)}` : "";
  return `${origin}${localePrefix}/pair?code=${encodeURIComponent(code)}`;
}

function pairingExpiry(ttlMinutes: number): Date {
  return new Date(Date.now() + ttlMinutes * 60_000);
}

function resolveStatus(
  row: {
    expiresAt: Date;
    consumedAt: Date | null;
  },
  now = new Date(),
): PairingStatus {
  if (row.consumedAt) {
    return "linked";
  }
  if (row.expiresAt <= now) {
    return "expired";
  }
  return "pending";
}

export async function createPairingCode(
  options: CreatePairingOptions,
): Promise<PairingCreateResult> {
  const { purpose, sourceSessionId, metadata = {}, ttlMinutes = DEFAULT_TTL_MINUTES } =
    options;

  if (!isPairingPurpose(purpose)) {
    throw new PairingError("Invalid pairing purpose.", "INVALID");
  }

  const sourceSession = await loadSession(sourceSessionId);
  if (!sourceSession) {
    throw new PairingError("Session not found.", "INVALID");
  }

  const strategy = getPairingStrategy(purpose);
  await strategy.validateCreate({ sourceSession, metadata });

  const db = getDb();
  const now = new Date();

  await db
    .delete(schema.credentialPairingCodes)
    .where(
      and(
        eq(schema.credentialPairingCodes.sourceSessionId, sourceSessionId),
        eq(schema.credentialPairingCodes.purpose, purpose),
        isNull(schema.credentialPairingCodes.consumedAt),
      ),
    );

  const code = nanoid(21);
  const expiresAt = pairingExpiry(ttlMinutes);

  await db.insert(schema.credentialPairingCodes).values({
    id: nanoid(16),
    code,
    purpose,
    sourceSessionId,
    sourceHqUserId: sourceSession.hqUserId,
    allianceId: sourceSession.currentAllianceId,
    expiresAt,
    metadataJson: metadata,
    createdAt: now,
  });

  return {
    code,
    linkUrl: buildPairingUrl(code, options.locale),
    expiresAt: expiresAt.toISOString(),
    purpose,
  };
}

export async function getPairingStatus(
  code: string,
  sourceSessionId: string,
): Promise<{ status: PairingStatus; linkedAt?: string; purpose?: PairingPurpose }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.credentialPairingCodes)
    .where(eq(schema.credentialPairingCodes.code, code))
    .limit(1);

  if (!row || row.sourceSessionId !== sourceSessionId) {
    return { status: "invalid" };
  }

  const status = resolveStatus(row);
  return {
    status,
    purpose: row.purpose as PairingPurpose,
    ...(row.consumedAt
      ? { linkedAt: row.consumedAt.toISOString() }
      : {}),
  };
}

type ClaimedPairingRow = {
  id: string;
  purpose: PairingPurpose;
  sourceSessionId: string;
  metadataJson: Record<string, unknown> | null;
};

export async function pairingClaimFailure(code: string): Promise<PairingError> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.credentialPairingCodes)
    .where(eq(schema.credentialPairingCodes.code, code))
    .limit(1);

  if (!row) {
    return new PairingError(
      "This link is invalid or has already been used.",
      "INVALID",
    );
  }

  if (row.consumedAt) {
    return new PairingError("This link has already been used.", "CONSUMED");
  }

  if (row.expiresAt <= new Date()) {
    return new PairingError(
      "This link expired. Generate a new QR code.",
      "EXPIRED",
    );
  }

  return new PairingError(
    "This link is invalid or has already been used.",
    "INVALID",
  );
}

/** Atomically claim an unconsumed, unexpired pairing code before side effects. */
export async function claimPairingCode(
  code: string,
  targetSessionId: string,
  now = new Date(),
): Promise<ClaimedPairingRow> {
  const db = getDb();

  const [claimed] = await db
    .update(schema.credentialPairingCodes)
    .set({
      consumedAt: now,
      consumedBySessionId: targetSessionId,
    })
    .where(
      and(
        eq(schema.credentialPairingCodes.code, code),
        isNull(schema.credentialPairingCodes.consumedAt),
        gt(schema.credentialPairingCodes.expiresAt, now),
      ),
    )
    .returning({
      id: schema.credentialPairingCodes.id,
      purpose: schema.credentialPairingCodes.purpose,
      sourceSessionId: schema.credentialPairingCodes.sourceSessionId,
      metadataJson: schema.credentialPairingCodes.metadataJson,
    });

  if (!claimed) {
    throw await pairingClaimFailure(code);
  }

  if (!isPairingPurpose(claimed.purpose)) {
    throw new PairingError("Invalid pairing purpose.", "INVALID");
  }

  return {
    id: claimed.id,
    purpose: claimed.purpose,
    sourceSessionId: claimed.sourceSessionId,
    metadataJson: claimed.metadataJson,
  };
}

export async function completePairing(
  code: string,
  targetSessionId: string,
  options?: { clientInfo?: PairingClientInfo },
): Promise<PairingCompleteResult> {
  const db = getDb();
  const [preview] = await db
    .select({ sourceSessionId: schema.credentialPairingCodes.sourceSessionId })
    .from(schema.credentialPairingCodes)
    .where(eq(schema.credentialPairingCodes.code, code))
    .limit(1);

  if (preview?.sourceSessionId === targetSessionId) {
    throw new PairingError(
      "Scan this QR code on a different device than the one that created it.",
      "INVALID",
    );
  }

  const row = await claimPairingCode(code, targetSessionId);

  const sourceSession = await loadSession(row.sourceSessionId);
  if (!sourceSession) {
    throw new PairingError("The pairing session is no longer valid.", "INVALID");
  }

  const strategy = getPairingStrategy(row.purpose);
  const metadata = (row.metadataJson ?? {}) as PairingMetadata;

  await strategy.onComplete({
    sourceSession,
    targetSessionId,
    metadata,
    pairingCodeId: row.id,
    clientInfo: options?.clientInfo,
  });

  return { ok: true, purpose: row.purpose };
}
