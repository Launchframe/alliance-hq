import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertCredentialShareOwnerForAlliance,
  createCredentialShareInvite,
  CredentialShareError,
  listCredentialSharesForAlliance,
} from "@/lib/ashed/credential-share.server";
import { listRecentAllianceShareActivity } from "@/lib/ashed/credential-share-audit.server";
import { CREDENTIAL_SHARE_CAPABILITIES } from "@/lib/ashed/credential-share-capabilities.shared";
import { createPairingCode } from "@/lib/credential-pairing";
import { AUTHORIZED_ACCESS_PAIRING_TTL_MINUTES } from "@/lib/credential-pairing/strategies/authorized-access";
import { getDb, schema } from "@/lib/db";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { loadSession, readSessionId } from "@/lib/session";

const createBodySchema = z.object({
  invitedHqUserId: z.string().trim().min(1),
  capabilities: z
    .array(z.enum(CREDENTIAL_SHARE_CAPABILITIES))
    .min(1),
  ttlHours: z.number().min(1).max(168),
  locale: z.string().optional(),
});

function credentialShareErrorResponse(error: CredentialShareError) {
  const status =
    error.code === "FORBIDDEN"
      ? 403
      : error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : error.code === "NOT_CONNECTED"
            ? 400
            : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? "en-US";
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  if (!access.allianceId) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  try {
    await assertCredentialShareOwnerForAlliance(sessionId, access.allianceId);
  } catch (error) {
    if (error instanceof CredentialShareError) {
      return credentialShareErrorResponse(error);
    }
    throw error;
  }

  const [shares, recentActivity] = await Promise.all([
    listCredentialSharesForAlliance(access.allianceId),
    listRecentAllianceShareActivity(access.allianceId, 5),
  ]);

  const db = getDb();
  const officerRows = await db
    .select({
      hqUserId: schema.allianceMemberships.hqUserId,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      roleName: schema.roles.name,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId),
    )
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.allianceMemberships.roleId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, access.allianceId),
        eq(schema.allianceMemberships.status, "active"),
        inArray(schema.allianceMemberships.roleId, [
          ROLE_IDS.owner,
          ROLE_IDS.maintainer,
          ROLE_IDS.officer,
        ]),
      ),
    );

  return NextResponse.json({
    shares,
    recentActivity,
    officerCandidates: officerRows,
  });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof createBodySchema>;
  try {
    body = createBodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { loadSession } = await import("@/lib/session");
  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireAllianceSettingsSession(session, body.locale ?? "en-US");
  if ("pickAlliance" in access || !access.allianceId) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  try {
    const { share } = await createCredentialShareInvite({
      sessionId,
      allianceId: access.allianceId,
      invitedHqUserId: body.invitedHqUserId,
      capabilities: body.capabilities,
      ttlHours: body.ttlHours,
    });

    const pairing = await createPairingCode({
      purpose: "authorized_access",
      sourceSessionId: sessionId,
      metadata: { shareId: share.id },
      ttlMinutes: AUTHORIZED_ACCESS_PAIRING_TTL_MINUTES,
      locale: body.locale,
    });

    return NextResponse.json({
      share,
      pairing,
    });
  } catch (error) {
    if (error instanceof CredentialShareError) {
      return credentialShareErrorResponse(error);
    }
    throw error;
  }
}
