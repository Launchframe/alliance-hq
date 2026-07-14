import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import {
  buildMemberIndex,
  matchMemberName,
  stringSimilarity,
  type MemberMatch,
} from "@/lib/video/member-matcher";
import {
  listHqAlliancesByTag,
  type HqAllianceCandidate,
} from "@/lib/vr/resolve-alliance-tag";
import { resolveCommanderIdForMember } from "@/lib/vr/repository";

/**
 * Fuzzy name matches at/above this confidence may auto-link FKs at commit.
 * Exact / previous_name always auto-link. Below this, candidate is surfaced for
 * review but member FKs stay null.
 */
export const DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN = 0.85;

/**
 * When exact tag lookup misses, allow a unique fuzzy tag hit at/above this
 * similarity (OCR tag length must be ≥ 3). 0.75 covers a single-character
 * OCR glitch on a 4-letter tag (e.g. Roa↔Roar).
 */
export const DEPOSIT_SLIP_TAG_FUZZY_MIN = 0.75;

/** Require this margin over the runner-up before accepting a fuzzy tag. */
const DEPOSIT_SLIP_TAG_FUZZY_MARGIN = 0.05;

export type DepositSlipTagMatchMethod =
  | "exact"
  | "fuzzy"
  | "none"
  | "ambiguous";

export type ResolvedDepositSlipLinks = {
  depositAllianceId: string | null;
  allianceMemberId: string | null;
  commanderId: string | null;
  ashedMemberId: string | null;
  /** Match metadata for the auto-linked member (or none when FKs are null). */
  matchMethod: MemberMatch["matchMethod"];
  matchConfidence: number;
  /**
   * Best roster candidate from name matching — set even when below the
   * auto-link threshold so review UIs can show weak / near-miss hits.
   */
  candidateAshedMemberId: string | null;
  candidateMemberName: string | null;
  candidateMatchMethod: MemberMatch["matchMethod"];
  candidateConfidence: number;
  tagMatchMethod: DepositSlipTagMatchMethod;
};

export type ResolveDepositSlipMemberLinksDeps = {
  listAlliancesByTag?: typeof listHqAlliancesByTag;
  listAlliancesWithTags?: () => Promise<HqAllianceCandidate[]>;
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

async function listAlliancesWithTagsDefault(): Promise<HqAllianceCandidate[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      ownerAshedUserId: schema.alliances.ownerAshedUserId,
    })
    .from(schema.alliances);
  return rows
    .filter((row) => row.tag?.trim())
    .map((row) => ({
      id: row.id,
      tag: row.tag!.trim(),
      name: row.name,
      ownerAshedUserId: row.ownerAshedUserId,
    }));
}

/** Exported for unit tests — unique fuzzy tag among HQ alliances. */
export function pickUniqueFuzzyAllianceTag(
  ocrTag: string,
  candidates: readonly HqAllianceCandidate[],
): HqAllianceCandidate | null {
  const needle = ocrTag.trim();
  if (needle.length < 3) return null;

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: stringSimilarity(needle, candidate.tag),
    }))
    .filter((row) => row.score >= DEPOSIT_SLIP_TAG_FUZZY_MIN)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0]!;
  const runnerUp = scored.find(
    (row) =>
      row.candidate.id !== best.candidate.id &&
      row.score >= best.score - DEPOSIT_SLIP_TAG_FUZZY_MARGIN,
  );
  if (runnerUp) return null;
  return best.candidate;
}

function canAutoLinkMember(match: MemberMatch): boolean {
  if (!match.memberId) return false;
  if (match.matchMethod === "exact" || match.matchMethod === "previous_name") {
    return true;
  }
  return (
    match.matchMethod === "fuzzy" &&
    match.confidence >= DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN
  );
}

/**
 * Resolve deposit-slip OCR identity into FKs at commit time:
 * - unique alliance tag (exact, then unique fuzzy) → `depositAllianceId`
 * - commander name match against that alliance's roster (falling back to the
 *   bank-owning alliance when the tag is missing/ambiguous) →
 *   `allianceMemberId` + `commanderId` when confidence clears the auto-link gate
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
  const listAlliancesWithTags =
    deps.listAlliancesWithTags ?? listAlliancesWithTagsDefault;
  const loadRosterMembers = deps.loadRosterMembers ?? loadLocalRosterMembers;
  const findAllianceMemberId =
    deps.findAllianceMemberId ?? findAllianceMemberIdByAshed;
  const resolveCommanderId =
    deps.resolveCommanderId ?? resolveCommanderIdForMember;

  const empty = (
    depositAllianceId: string | null,
    tagMatchMethod: DepositSlipTagMatchMethod,
  ): ResolvedDepositSlipLinks => ({
    depositAllianceId,
    allianceMemberId: null,
    commanderId: null,
    ashedMemberId: null,
    matchMethod: "none",
    matchConfidence: 0,
    candidateAshedMemberId: null,
    candidateMemberName: null,
    candidateMatchMethod: "none",
    candidateConfidence: 0,
    tagMatchMethod,
  });

  const tag = input.depositAllianceTag?.trim() || null;
  let depositAllianceId: string | null = null;
  let tagMatchMethod: DepositSlipTagMatchMethod = "none";

  if (tag) {
    const exact = await listAlliancesByTag(tag);
    if (exact.length === 1) {
      depositAllianceId = exact[0]!.id;
      tagMatchMethod = "exact";
    } else if (exact.length > 1) {
      tagMatchMethod = "ambiguous";
    } else {
      const fuzzyHit = pickUniqueFuzzyAllianceTag(
        tag,
        await listAlliancesWithTags(),
      );
      if (fuzzyHit) {
        depositAllianceId = fuzzyHit.id;
        tagMatchMethod = "fuzzy";
      }
    }
  }

  const rosterAllianceId = depositAllianceId ?? input.bankAllianceId;
  const members = await loadRosterMembers(rosterAllianceId);
  if (members.length === 0 || !input.commanderName.trim()) {
    return empty(depositAllianceId, tagMatchMethod);
  }

  const match = matchMemberName(
    input.commanderName,
    buildMemberIndex(members),
    { allianceTag: tag },
  );

  const candidateAshedMemberId = match.memberId;
  const candidateMemberName = match.memberName;
  const candidateMatchMethod = match.matchMethod;
  const candidateConfidence = match.confidence;

  if (!canAutoLinkMember(match)) {
    return {
      depositAllianceId,
      allianceMemberId: null,
      commanderId: null,
      ashedMemberId: null,
      matchMethod: "none",
      matchConfidence: 0,
      candidateAshedMemberId,
      candidateMemberName,
      candidateMatchMethod,
      candidateConfidence,
      tagMatchMethod,
    };
  }

  const [allianceMemberId, commanderId] = await Promise.all([
    findAllianceMemberId(rosterAllianceId, match.memberId!),
    resolveCommanderId(rosterAllianceId, match.memberId!),
  ]);

  return {
    depositAllianceId,
    allianceMemberId,
    commanderId,
    ashedMemberId: match.memberId,
    matchMethod: match.matchMethod,
    matchConfidence: match.confidence,
    candidateAshedMemberId,
    candidateMemberName,
    candidateMatchMethod,
    candidateConfidence,
    tagMatchMethod,
  };
}
