import { and, eq, isNull } from "drizzle-orm";
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

async function loadPairingRow(code: string): Promise<{
  id: string;
  purpose: PairingPurpose;
  sourceSessionId: string;
  metadataJson: Record<string, unknown> | null;
}> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.credentialPairingCodes)
    .where(eq(schema.credentialPairingCodes.code, code))
    .limit(1);

  if (!row) {
    throw new PairingError("This link is invalid or has already been used.", "INVALID");
  }

  if (row.consumedAt) {
    throw new PairingError("This link has already been used.", "CONSUMED");
  }

  if (row.expiresAt <= new Date()) {
    throw new PairingError("This link expired. Generate a new QR code.", "EXPIRED");
  }

  if (!isPairingPurpose(row.purpose)) {
    throw new PairingError("Invalid pairing purpose.", "INVALID");
  }

  const purpose = row.purpose;

  return {
    id: row.id,
    purpose,
    sourceSessionId: row.sourceSessionId,
    metadataJson: row.metadataJson,
  };
}

export async function completePairing(
  code: string,
  targetSessionId: string,
  options?: { clientInfo?: PairingClientInfo },
): Promise<PairingCompleteResult> {
  const row = await loadPairingRow(code);
  const purpose = row.purpose;

  const sourceSession = await loadSession(row.sourceSessionId);
  if (!sourceSession) {
    throw new PairingError("The pairing session is no longer valid.", "INVALID");
  }

  const strategy = getPairingStrategy(purpose);
  const metadata = (row.metadataJson ?? {}) as PairingMetadata;

  await strategy.onComplete({
    sourceSession,
    targetSessionId,
    metadata,
    pairingCodeId: row.id,
    clientInfo: options?.clientInfo,
  });

  const db = getDb();
  const consumedAt = new Date();

  await db
    .update(schema.credentialPairingCodes)
    .set({
      consumedAt,
      consumedBySessionId: targetSessionId,
    })
    .where(eq(schema.credentialPairingCodes.id, row.id));

  return { ok: true, purpose };
}
