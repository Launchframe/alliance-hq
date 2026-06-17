import { sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  findExactMemberByName,
  normalizeName,
} from "@/lib/vr/link-helpers";
import { listDiscordLinksForUser } from "@/lib/vr/repository";

export type HqAllianceCandidate = {
  id: string;
  tag: string;
  name: string;
  ownerAshedUserId: string | null;
};

export type ResolveAllianceByTagResult =
  | { ok: true; alliance: HqAllianceCandidate }
  | {
      ok: false;
      reason: "not_found" | "ambiguous";
      candidates?: HqAllianceCandidate[];
    };

export type ResolveAllianceByTagContext = {
  discordUserId?: string;
  reportedName?: string;
  gameUid?: string;
  allianceName?: string;
};

function normalizeTag(tag: string): string {
  return tag.trim();
}

export async function listHqAlliancesByTag(tag: string): Promise<HqAllianceCandidate[]> {
  const needle = normalizeTag(tag).toLowerCase();
  if (!needle) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      ownerAshedUserId: schema.alliances.ownerAshedUserId,
    })
    .from(schema.alliances)
    .where(sql`lower(${schema.alliances.tag}) = ${needle}`);

  return rows
    .filter((row) => row.tag?.trim())
    .map((row) => ({
      id: row.id,
      tag: row.tag!.trim(),
      name: row.name,
      ownerAshedUserId: row.ownerAshedUserId,
    }));
}

async function filterCandidatesByMemberLink(
  candidates: HqAllianceCandidate[],
  discordUserId: string,
): Promise<HqAllianceCandidate[]> {
  const matches: HqAllianceCandidate[] = [];
  for (const candidate of candidates) {
    const links = await listDiscordLinksForUser(candidate.id, discordUserId);
    if (links.length === 0) continue;
    const members = await loadAllianceMembersForBot(candidate.id);
    const linkedIds = new Set(links.map((l) => l.ashedMemberId));
    if (members.some((m) => linkedIds.has(m.id))) {
      matches.push(candidate);
    }
  }
  return matches;
}

async function filterCandidatesByGameIdentity(
  candidates: HqAllianceCandidate[],
  reportedName: string,
  gameUid: string,
): Promise<HqAllianceCandidate[]> {
  const matches: HqAllianceCandidate[] = [];
  for (const candidate of candidates) {
    const members = await loadAllianceMembersForBot(candidate.id);
    const exact = findExactMemberByName(members, reportedName);
    if (exact) {
      matches.push(candidate);
      continue;
    }
    if (gameUid.trim()) {
      const needle = normalizeName(reportedName);
      const fuzzy = members.find(
        (m) => normalizeName(m.current_name) === needle,
      );
      if (fuzzy) matches.push(candidate);
    }
  }
  return matches;
}

function filterCandidatesByAllianceName(
  candidates: HqAllianceCandidate[],
  allianceName: string,
): HqAllianceCandidate[] {
  const needle = normalizeName(allianceName);
  if (!needle) return candidates;
  const exact = candidates.filter(
    (c) => normalizeName(c.name) === needle,
  );
  if (exact.length > 0) return exact;
  return candidates.filter((c) =>
    normalizeName(c.name).includes(needle),
  );
}

export async function resolveAllianceByTag(
  tag: string,
  context: ResolveAllianceByTagContext = {},
): Promise<ResolveAllianceByTagResult> {
  const normalized = normalizeTag(tag);
  if (!normalized) {
    return { ok: false, reason: "not_found" };
  }

  let candidates = await listHqAlliancesByTag(normalized);
  if (candidates.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (candidates.length === 1) {
    return { ok: true, alliance: candidates[0]! };
  }

  if (context.discordUserId) {
    const byLink = await filterCandidatesByMemberLink(
      candidates,
      context.discordUserId,
    );
    if (byLink.length === 1) {
      return { ok: true, alliance: byLink[0]! };
    }
    if (byLink.length > 1) {
      candidates = byLink;
    }
  }

  if (context.reportedName?.trim() && context.gameUid?.trim()) {
    const byGame = await filterCandidatesByGameIdentity(
      candidates,
      context.reportedName,
      context.gameUid,
    );
    if (byGame.length === 1) {
      return { ok: true, alliance: byGame[0]! };
    }
    if (byGame.length > 1) {
      candidates = byGame;
    }
  }

  if (context.allianceName?.trim()) {
    const byName = filterCandidatesByAllianceName(
      candidates,
      context.allianceName,
    );
    if (byName.length === 1) {
      return { ok: true, alliance: byName[0]! };
    }
    if (byName.length > 1) {
      candidates = byName;
    }
  }

  if (candidates.length === 1) {
    return { ok: true, alliance: candidates[0]! };
  }

  return { ok: false, reason: "ambiguous", candidates };
}

export async function getAllianceByTag(tag: string): Promise<HqAllianceCandidate | null> {
  const result = await resolveAllianceByTag(tag);
  return result.ok ? result.alliance : null;
}
