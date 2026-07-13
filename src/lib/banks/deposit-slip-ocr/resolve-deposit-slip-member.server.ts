import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import {
  buildMemberIndex,
  matchMemberName,
  type MemberMatch,
} from "@/lib/video/member-matcher";
import { listHqAlliancesByTag } from "@/lib/vr/resolve-alliance-tag";
import { resolveCommanderIdForMember } from "@/lib/vr/repository";

export type ResolvedDepositSlipLinks = {
  depositAllianceId: string | null;
  allianceMemberId: string | null;
  commanderId: string | null;
  ashedMemberId: string | null;
  matchMethod: MemberMatch["matchMethod"];
  matchConfidence: number;
};

export type ResolveDepositSlipMemberLinksDeps = {
  listAlliancesByTag?: typeof listHqAlliancesByTag;
  loadRosterMembers?: (
    allianceId: string,
  ) => Promise<ReturnType<typeof allianceMemberRowToAshedMember>[]>;
  findAllianceMemberId?: (
    allianceId: string,
    ashedMemberId: string,
  ) => Promise<string | null>;
  resolveCommanderId?: typeof resolveCommanderIdForMember;
};

async function loadLocalRosterMembers(allianceId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    );
  return rows.map(allianceMemberRowToAshedMember);
}

async function findAllianceMemberIdByAshed(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.allianceMembers.id })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Resolve deposit-slip OCR identity into FKs at commit time:
 * - unique alliance tag → `depositAllianceId`
 * - commander name match against that alliance's roster (falling back to the
 *   bank-owning alliance when the tag is missing/ambiguous) →
 *   `allianceMemberId` + `commanderId`
 */
export async function resolveDepositSlipMemberLinks(
  input: {
    bankAllianceId: string;
    depositAllianceTag: string | null | undefined;
    commanderName: string;
  },
  deps: ResolveDepositSlipMemberLinksDeps = {},
): Promise<ResolvedDepositSlipLinks> {
  const listAlliancesByTag = deps.listAlliancesByTag ?? listHqAlliancesByTag;
  const loadRosterMembers = deps.loadRosterMembers ?? loadLocalRosterMembers;
  const findAllianceMemberId =
    deps.findAllianceMemberId ?? findAllianceMemberIdByAshed;
  const resolveCommanderId =
    deps.resolveCommanderId ?? resolveCommanderIdForMember;

  const tag = input.depositAllianceTag?.trim() || null;
  let depositAllianceId: string | null = null;
  if (tag) {
    const candidates = await listAlliancesByTag(tag);
    if (candidates.length === 1) {
      depositAllianceId = candidates[0]!.id;
    }
  }

  const rosterAllianceId = depositAllianceId ?? input.bankAllianceId;
  const members = await loadRosterMembers(rosterAllianceId);
  if (members.length === 0 || !input.commanderName.trim()) {
    return {
      depositAllianceId,
      allianceMemberId: null,
      commanderId: null,
      ashedMemberId: null,
      matchMethod: "none",
      matchConfidence: 0,
    };
  }

  const match = matchMemberName(
    input.commanderName,
    buildMemberIndex(members),
    { allianceTag: tag },
  );

  if (!match.memberId) {
    return {
      depositAllianceId,
      allianceMemberId: null,
      commanderId: null,
      ashedMemberId: null,
      matchMethod: match.matchMethod,
      matchConfidence: match.confidence,
    };
  }

  const [allianceMemberId, commanderId] = await Promise.all([
    findAllianceMemberId(rosterAllianceId, match.memberId),
    resolveCommanderId(rosterAllianceId, match.memberId),
  ]);

  return {
    depositAllianceId,
    allianceMemberId,
    commanderId,
    ashedMemberId: match.memberId,
    matchMethod: match.matchMethod,
    matchConfidence: match.confidence,
  };
}
