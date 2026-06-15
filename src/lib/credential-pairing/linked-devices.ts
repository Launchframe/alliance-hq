import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  defaultLinkedDeviceName,
  parseOsLabelFromUserAgent,
  truncateUserAgent,
} from "@/lib/credential-pairing/user-agent";
import { getDb, schema } from "@/lib/db";

const LAST_ACCESS_TOUCH_MINUTES = 5;

export type LinkedDeviceSummary = {
  id: string;
  deviceName: string;
  osLabel: string | null;
  userAgent: string | null;
  linkedAt: string;
  lastAccessAt: string | null;
  isCurrentDevice: boolean;
};

export async function registerLinkedDevice(options: {
  hqUserId: string;
  sessionId: string;
  pairingCodeId: string;
  userAgent?: string | null;
}): Promise<string> {
  const userAgent = truncateUserAgent(options.userAgent);
  const osLabel = parseOsLabelFromUserAgent(userAgent);
  const deviceName = defaultLinkedDeviceName(osLabel);
  const now = new Date();
  const id = nanoid(16);
  const db = getDb();

  await db.insert(schema.linkedDevices).values({
    id,
    hqUserId: options.hqUserId,
    sessionId: options.sessionId,
    pairingCodeId: options.pairingCodeId,
    deviceName,
    userAgent,
    osLabel,
    linkedAt: now,
    lastAccessAt: now,
  });

  return id;
}

export async function listActiveLinkedDevicesForUser(
  hqUserId: string,
  currentSessionId: string,
): Promise<LinkedDeviceSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.linkedDevices)
    .where(
      and(
        eq(schema.linkedDevices.hqUserId, hqUserId),
        isNull(schema.linkedDevices.revokedAt),
      ),
    )
    .orderBy(desc(schema.linkedDevices.linkedAt));

  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    osLabel: row.osLabel,
    userAgent: row.userAgent,
    linkedAt: row.linkedAt.toISOString(),
    lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
    isCurrentDevice: row.sessionId === currentSessionId,
  }));
}

export async function renameLinkedDevice(
  hqUserId: string,
  deviceId: string,
  deviceName: string,
): Promise<void> {
  const trimmed = deviceName.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new Error("Device name must be 1–64 characters.");
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.linkedDevices)
    .set({ deviceName: trimmed })
    .where(
      and(
        eq(schema.linkedDevices.id, deviceId),
        eq(schema.linkedDevices.hqUserId, hqUserId),
        isNull(schema.linkedDevices.revokedAt),
      ),
    )
    .returning({ id: schema.linkedDevices.id });

  if (!updated) {
    throw new Error("Linked device not found.");
  }
}

async function disconnectLinkedSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId));

  await db
    .update(schema.sessions)
    .set({
      userLabel: null,
      allianceId: null,
      allianceTag: null,
      hqUserId: null,
      currentAllianceId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
}

export async function revokeLinkedDevice(
  hqUserId: string,
  deviceId: string,
  currentSessionId?: string,
): Promise<{ revokedCurrentSession: boolean }> {
  const db = getDb();
  const [device] = await db
    .select()
    .from(schema.linkedDevices)
    .where(
      and(
        eq(schema.linkedDevices.id, deviceId),
        eq(schema.linkedDevices.hqUserId, hqUserId),
        isNull(schema.linkedDevices.revokedAt),
      ),
    )
    .limit(1);

  if (!device) {
    throw new Error("Linked device not found.");
  }

  const now = new Date();
  await db
    .update(schema.linkedDevices)
    .set({ revokedAt: now })
    .where(eq(schema.linkedDevices.id, device.id));

  await disconnectLinkedSession(device.sessionId);

  return {
    revokedCurrentSession:
      currentSessionId !== undefined && device.sessionId === currentSessionId,
  };
}

/** Throttled last-access touch for linked mobile sessions. */
export async function touchLinkedDeviceAccess(sessionId: string): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - LAST_ACCESS_TOUCH_MINUTES * 60_000);

  await db
    .update(schema.linkedDevices)
    .set({ lastAccessAt: new Date() })
    .where(
      and(
        eq(schema.linkedDevices.sessionId, sessionId),
        isNull(schema.linkedDevices.revokedAt),
        sql`(${schema.linkedDevices.lastAccessAt} IS NULL OR ${schema.linkedDevices.lastAccessAt} < ${cutoff})`,
      ),
    );
}
