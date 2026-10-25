import "server-only";

import { and, eq } from "drizzle-orm";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { isSyntheticNativeAshedAllianceId } from "@/lib/lastrank/ashed-credential.server";
import { mergeDuplicateCommander } from "@/lib/members/merge-duplicate-commander.server";
import {
  groupRosterDuplicates,
  reviewMergePairs,
  selectionIncludesAmbiguous,
  type RosterDuplicateCandidate,
  type RosterDuplicateGroup,
  type RosterDuplicateGroupView,
  type RosterDuplicateInexactPair,
  type RosterDuplicateMemberView,
  type RosterDuplicateScan,
} from "@/lib/members/roster-duplicate-groups.shared";
import { resolveAllianceAshedBotConnection } from "@/lib/vr/member-roster";

type LoadedMember = RosterDuplicateCandidate & {
  powerLevel: string | null;
  memberLevel: number | null;
  totalHeroPower: number | null;
  profession: string | null;
};

type RosterModel = {
  hasBotCredential: boolean;
  members: LoadedMember[];
  groups: RosterDuplicateGroup[];
  unmatchedSyntheticIds: string[];
};

export type RosterDuplicateBatchItem = {
  ashedMemberId: string;
  name: string;
  code?: string;
};

export type RosterDuplicateBatchResult = {
  merged: RosterDuplicateBatchItem[];
  removed: RosterDuplicateBatchItem[];
  skipped: RosterDuplicateBatchItem[];
  failed: RosterDuplicateBatchItem[];
};

export type RosterDuplicateMergeRejection =
  | { code: "ambiguous_selection" }
  | { code: "inexact_confirmation_required"; pairs: RosterDuplicateInexactPair[] };

export async function scanRosterDuplicates(
  allianceId: string,
): Promise<RosterDuplicateScan | null> {
  const model = await loadRosterModel(allianceId);
  if (!model) return null;
  return toScan(model);
}

export async function mergeRosterDuplicates(input: {
  allianceId: string;
  ashedMemberIds: string[];
  confirmInexact: boolean;
  actorHqUserId: string | null;
  sessionId: string | null;
}): Promise<
  | { ok: true; result: RosterDuplicateBatchResult }
  | { ok: false; rejection: RosterDuplicateMergeRejection }
  | { ok: false; code: "not_found" }
> {
  const model = await loadRosterModel(input.allianceId);
  if (!model) return { ok: false, code: "not_found" };

  const selected = new Set(input.ashedMemberIds);
  const names = new Map(model.members.map((member) => [member.ashedMemberId, member.name]));
  const pairs = reviewMergePairs(model.groups, names, selected);
  const needsConfirmation =
    pairs.length > 0 || selectionIncludesAmbiguous(model.groups, selected);
  if (needsConfirmation && !input.confirmInexact) {
    return {
      ok: false,
      rejection: { code: "inexact_confirmation_required", pairs },
    };
  }

  const byId = new Map(model.members.map((member) => [member.ashedMemberId, member]));
  const result: RosterDuplicateBatchResult = {
    merged: [],
    removed: [],
    skipped: [],
    failed: [],
  };

  for (const ashedMemberId of selected) {
    const member = byId.get(ashedMemberId);
    const name = member?.name ?? ashedMemberId;
    const group = model.groups.find((candidate) =>
      candidate.memberIds.includes(ashedMemberId),
    );
    if (!member || !group) {
      result.failed.push({ ashedMemberId, name, code: "not_found" });
      continue;
    }
    if (group.keeperAshedMemberId === ashedMemberId) {
      result.skipped.push({ ashedMemberId, name, code: "keeper" });
      continue;
    }
    if (!group.keeperAshedMemberId) {
      result.failed.push({ ashedMemberId, name, code: "no_recommended_keeper" });
      continue;
    }

    const merged = await mergeDuplicateCommander({
      allianceId: input.allianceId,
      keptAshedMemberId: group.keeperAshedMemberId,
      duplicateAshedMemberId: ashedMemberId,
      actorHqUserId: input.actorHqUserId,
      sessionId: input.sessionId,
    });
    if (!merged.ok) {
      result.failed.push({ ashedMemberId, name, code: merged.code });
      continue;
    }
    if (merged.summary.ashedRetireFailed) {
      result.failed.push({ ashedMemberId, name, code: "ashed_retire_failed" });
      continue;
    }
    result.merged.push({ ashedMemberId, name });
  }

  if (result.merged.length > 0) {
    const { pruneFormerMembersFromOpenPools } = await import("@/lib/trains/pool");
    await pruneFormerMembersFromOpenPools(input.allianceId);
  }
  return { ok: true, result };
}

export async function removeRosterDuplicates(input: {
  allianceId: string;
  ashedMemberIds: string[];
  actorHqUserId: string | null;
  sessionId: string | null;
}): Promise<
  { ok: true; result: RosterDuplicateBatchResult } | { ok: false; code: "not_found" }
> {
  const [alliance] = await getDb()
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);
  if (!alliance) return { ok: false, code: "not_found" };

  const result: RosterDuplicateBatchResult = {
    merged: [],
    removed: [],
    skipped: [],
    failed: [],
  };
  for (const ashedMemberId of new Set(input.ashedMemberIds)) {
    const retired = await retireRosterMember({
      allianceId: input.allianceId,
      ashedMemberId,
      actorHqUserId: input.actorHqUserId,
      sessionId: input.sessionId,
    });
    if (retired.ok) {
      result.removed.push({ ashedMemberId, name: retired.name });
    } else {
      result.failed.push({
        ashedMemberId,
        name: retired.name,
        code: retired.code,
      });
    }
  }
  if (result.removed.length > 0) {
    const { pruneFormerMembersFromOpenPools } = await import("@/lib/trains/pool");
    await pruneFormerMembersFromOpenPools(input.allianceId);
  }
  return { ok: true, result };
}

async function retireRosterMember(input: {
  allianceId: string;
  ashedMemberId: string;
  actorHqUserId: string | null;
  sessionId: string | null;
}): Promise<{ ok: true; name: string } | { ok: false; name: string; code: string }> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.allianceMembers.id,
      name: schema.allianceMembers.currentName,
      ashedAllianceId: schema.allianceMembers.ashedAllianceId,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);
  if (!row || row.status === "former") {
    return { ok: false, name: row?.name ?? input.ashedMemberId, code: "not_found" };
  }

  const ashedAllianceId = await getAshedAllianceIdIfLinked(input.allianceId);
  const remoteDuplicate =
    Boolean(ashedAllianceId) &&
    !isSyntheticNativeAshedAllianceId(ashedAllianceId) &&
    row.ashedAllianceId === ashedAllianceId;
  if (remoteDuplicate) {
    const connection = await resolveAllianceAshedBotConnection(input.allianceId);
    if (!connection) {
      return { ok: false, name: row.name, code: "ashed_connection_required" };
    }
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.allianceMembers)
      .set({ status: "former", gameUid: null, updatedAt: now })
      .where(eq(schema.allianceMembers.id, row.id));
    await tx
      .update(schema.commanderAllianceMemberships)
      .set({ status: "former", leftAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
          eq(schema.commanderAllianceMemberships.ashedMemberId, input.ashedMemberId),
        ),
      );
    await writeAuditLog(
      {
        sessionId: input.sessionId,
        allianceId: input.allianceId,
        hqUserId: input.actorHqUserId,
        action: "roster_member_retired",
        resourceType: "alliance_member",
        resourceId: input.ashedMemberId,
        resourceName: row.name,
        metadata: { ashedMemberId: input.ashedMemberId },
        severity: "override",
      },
      tx,
    );
  });
  return { ok: true, name: row.name };
}

async function loadRosterModel(allianceId: string): Promise<RosterModel | null> {
  const db = getDb();
  const [alliance] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  if (!alliance) return null;

  const [credential] = await db
    .select({ id: schema.allianceAshedCredentials.id })
    .from(schema.allianceAshedCredentials)
    .where(eq(schema.allianceAshedCredentials.allianceId, allianceId))
    .limit(1);

  const rows = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      name: schema.allianceMembers.currentName,
      memberAshedAllianceId: schema.allianceMembers.ashedAllianceId,
      createdAt: schema.allianceMembers.createdAt,
      gameUid: schema.commanders.gameUid,
      powerLevel: schema.commanders.powerLevel,
      memberLevel: schema.commanders.memberLevel,
      totalHeroPower: schema.commanders.currentTotalHeroPower,
      profession: schema.commanders.profession,
      hqUserId: schema.hqMemberLinks.hqUserId,
      discordUserId: schema.discordMemberLinks.discordUserId,
    })
    .from(schema.allianceMembers)
    .leftJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.allianceId,
          schema.allianceMembers.allianceId,
        ),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
        eq(schema.commanderAllianceMemberships.status, "active"),
      ),
    )
    .leftJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .leftJoin(
      schema.hqMemberLinks,
      and(
        eq(schema.hqMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, schema.allianceMembers.ashedMemberId),
      ),
    )
    .leftJoin(
      schema.discordMemberLinks,
      and(
        eq(schema.discordMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(
          schema.discordMemberLinks.ashedMemberId,
          schema.allianceMembers.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.status, "active"),
      ),
    );

  const byId = new Map<string, LoadedMember>();
  for (const row of rows) {
    const existing = byId.get(row.ashedMemberId);
    const linked = Boolean(row.hqUserId || row.discordUserId);
    const hasGameUid = row.gameUid != null && row.gameUid !== "";
    if (!existing) {
      byId.set(row.ashedMemberId, {
        ashedMemberId: row.ashedMemberId,
        name: row.name,
        synthetic: isSyntheticNativeAshedAllianceId(row.memberAshedAllianceId),
        linkedAccount: linked,
        hasGameUid,
        createdAt: row.createdAt.getTime(),
        powerLevel: row.powerLevel,
        memberLevel: row.memberLevel,
        totalHeroPower: row.totalHeroPower,
        profession: row.profession,
      });
      continue;
    }
    existing.linkedAccount = existing.linkedAccount || linked;
    existing.hasGameUid = existing.hasGameUid || hasGameUid;
    existing.powerLevel = existing.powerLevel ?? row.powerLevel;
    existing.memberLevel = existing.memberLevel ?? row.memberLevel;
    existing.totalHeroPower = existing.totalHeroPower ?? row.totalHeroPower;
    existing.profession = existing.profession ?? row.profession;
  }

  const members = [...byId.values()];
  const grouped = groupRosterDuplicates(members);
  return {
    hasBotCredential: Boolean(credential),
    members,
    groups: grouped.groups,
    unmatchedSyntheticIds: grouped.unmatchedSyntheticIds,
  };
}

function toScan(model: RosterModel): RosterDuplicateScan {
  const byId = new Map(model.members.map((member) => [member.ashedMemberId, member]));
  const groups: RosterDuplicateGroupView[] = model.groups.map((group) => {
    const members = group.memberIds
      .map((id) => byId.get(id))
      .filter((member): member is LoadedMember => Boolean(member))
      .sort((a, b) => {
        const keeper =
          Number(b.ashedMemberId === group.keeperAshedMemberId) -
          Number(a.ashedMemberId === group.keeperAshedMemberId);
        if (keeper !== 0) return keeper;
        return a.name.localeCompare(b.name);
      });
    return {
      id: group.id,
      kind: group.kind,
      keeperAshedMemberId: group.keeperAshedMemberId,
      members: members.map((member) =>
        toView(member, {
          keeper: member.ashedMemberId === group.keeperAshedMemberId,
          defaultChecked:
            group.kind === "exact" &&
            member.ashedMemberId !== group.keeperAshedMemberId,
        }),
      ),
    };
  });

  const unmatchedLastRank = model.unmatchedSyntheticIds
    .map((id) => byId.get(id))
    .filter((member): member is LoadedMember => Boolean(member))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((member) => toView(member, { keeper: false, defaultChecked: false }));

  return {
    hasBotCredential: model.hasBotCredential,
    groups,
    unmatchedLastRank,
  };
}

function toView(
  member: LoadedMember,
  flags: { keeper: boolean; defaultChecked: boolean },
): RosterDuplicateMemberView {
  return {
    ashedMemberId: member.ashedMemberId,
    name: member.name,
    synthetic: member.synthetic,
    linkedAccount: member.linkedAccount,
    hasGameUid: member.hasGameUid,
    defaultChecked: flags.defaultChecked,
    keeper: flags.keeper,
    powerLevel: member.powerLevel,
    memberLevel: member.memberLevel,
    totalHeroPower: member.totalHeroPower,
    profession: member.profession,
  };
}
