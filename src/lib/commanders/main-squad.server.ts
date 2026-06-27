import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  type MainSquadSource,
  type MainSquadType,
  parseMainSquadType,
} from "@/lib/commanders/main-squad.shared";
import {
  assertCommanderReadAccess,
  loadAllianceCommander,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import { sessionHasPermission } from "@/lib/rbac/context";

export class MainSquadAccessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MainSquadAccessError";
    this.status = status;
  }
}

export async function listOwnedAshedMemberIdsForViewer(input: {
  hqUserId: string;
  allianceId: string;
}): Promise<string[]> {
  const db = getDb();
  const owned = new Set<string>();

  const hqLinks = await db
    .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
      ),
    );

  for (const link of hqLinks) {
    owned.add(link.ashedMemberId);
  }

  const commanderLinks = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
    })
    .from(schema.hqUserCommanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(
        schema.commanderAllianceMemberships.commanderId,
        schema.hqUserCommanders.commanderId,
      ),
    )
    .where(
      and(
        eq(schema.hqUserCommanders.hqUserId, input.hqUserId),
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  for (const link of commanderLinks) {
    owned.add(link.ashedMemberId);
  }

  return [...owned];
}

async function viewerOwnsMember(input: {
  hqUserId: string | null;
  allianceId: string;
  ashedMemberId: string;
}): Promise<boolean> {
  if (!input.hqUserId) return false;
  const owned = await listOwnedAshedMemberIdsForViewer({
    hqUserId: input.hqUserId,
    allianceId: input.allianceId,
  });
  return owned.includes(input.ashedMemberId);
}

async function resolveCommanderIdForMember(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<string | null> {
  const db = getDb();
  const [membership] = await db
    .select({ commanderId: schema.commanderAllianceMemberships.commanderId })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          input.ashedMemberId,
        ),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    )
    .limit(1);
  return membership?.commanderId ?? null;
}

export async function syncCommanderCurrentAllianceId(
  commanderId: string,
): Promise<void> {
  const db = getDb();
  const [active] = await db
    .select({ allianceId: schema.commanderAllianceMemberships.allianceId })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.commanderId, commanderId),
        isNull(schema.commanderAllianceMemberships.leftAt),
        eq(schema.commanderAllianceMemberships.status, "active"),
      ),
    )
    .orderBy(desc(schema.commanderAllianceMemberships.joinedAt))
    .limit(1);

  await db
    .update(schema.commanders)
    .set({
      currentAllianceId: active?.allianceId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.commanders.id, commanderId));
}

async function dualWriteMainSquad(input: {
  allianceId: string;
  ashedMemberId: string;
  commanderId: string | null;
  mainSquad: MainSquadType;
  source: MainSquadSource;
}): Promise<void> {
  const db = getDb();
  const now = new Date();

  if (input.commanderId) {
    await db
      .update(schema.commanders)
      .set({
        mainSquad: input.mainSquad,
        mainSquadSource: input.source,
        mainSquadUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, input.commanderId));
  }

  await db
    .update(schema.allianceMembers)
    .set({
      mainSquad: input.mainSquad,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
}

export async function setMemberMainSquad(input: {
  sessionId: string;
  ashedMemberId: string;
  mainSquad: unknown;
  asOfficerOverride?: boolean;
}): Promise<{ mainSquad: MainSquadType; source: MainSquadSource }> {
  const mainSquad = parseMainSquadType(input.mainSquad);
  if (!mainSquad) {
    throw new MainSquadAccessError("Invalid main squad type.", 400);
  }

  const { allianceId, hqUserId } = await resolveCommanderSessionContext(
    input.sessionId,
  );
  await assertCommanderReadAccess(input.sessionId, allianceId);

  const memberRow = await loadAllianceCommander(allianceId, input.ashedMemberId);
  if (!memberRow) {
    throw new MainSquadAccessError("Commander not found.", 404);
  }

  const canWrite = await sessionHasPermission(input.sessionId, "members:write");

  let source: MainSquadSource;
  if (input.asOfficerOverride) {
    if (!canWrite) {
      throw new MainSquadAccessError("Forbidden.", 403);
    }
    source = "officer_override";
  } else {
    const ownsMember = await viewerOwnsMember({
      hqUserId,
      allianceId,
      ashedMemberId: input.ashedMemberId,
    });
    if (!ownsMember) {
      throw new MainSquadAccessError("Forbidden.", 403);
    }
    source = "self_report";
  }

  const commanderId = await resolveCommanderIdForMember({
    allianceId,
    ashedMemberId: input.ashedMemberId,
  });

  await dualWriteMainSquad({
    allianceId,
    ashedMemberId: input.ashedMemberId,
    commanderId,
    mainSquad,
    source,
  });

  return { mainSquad, source };
}

export async function viewerCanEditMainSquad(input: {
  sessionId: string;
  allianceId: string;
  ashedMemberId: string;
}): Promise<boolean> {
  const { hqUserId } = await resolveCommanderSessionContext(input.sessionId);
  const canWrite = await sessionHasPermission(input.sessionId, "members:write");
  if (canWrite) return true;
  return viewerOwnsMember({
    hqUserId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
  });
}
