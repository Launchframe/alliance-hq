import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { continuousTenureDays, metric, normalizeCountry } from "./display-preferences.shared";
import type { SupportRosterMember } from "./types.shared";

export type SupportReader = Pick<ReturnType<typeof getDb>, "select">;
export async function loadSupportRoster(allianceId: string, db: SupportReader = getDb(), now = Date.now()): Promise<SupportRosterMember[]> {
  const rows = await db.select({
    id: schema.allianceMembers.ashedMemberId,
    name: schema.allianceMembers.currentName,
    previousNames: schema.allianceMembers.previousNamesJson,
    rank: schema.allianceMembers.allianceRank,
    country: schema.commanders.lastrankCountry,
    professionLevel: schema.commanders.professionalLevel,
    baseLevel: schema.commanders.memberLevel,
    basePower: schema.commanders.powerLevel,
    kills: schema.commanders.currentKills,
    thp: schema.commanders.currentTotalHeroPower,
  }).from(schema.allianceMembers)
    .leftJoin(schema.commanderAllianceMemberships, and(
      eq(schema.commanderAllianceMemberships.allianceId, schema.allianceMembers.allianceId),
      eq(schema.commanderAllianceMemberships.ashedMemberId, schema.allianceMembers.ashedMemberId),
      eq(schema.commanderAllianceMemberships.status, "active"),
      isNull(schema.commanderAllianceMemberships.leftAt),
    ))
    .leftJoin(schema.commanders, eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId))
    .where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.status, "active")));
  const stints = await db.select({ memberId: schema.memberAllianceTenure.ashedMemberId, joinedAt: schema.memberAllianceTenure.joinedAt })
    .from(schema.memberAllianceTenure).where(and(eq(schema.memberAllianceTenure.allianceId, allianceId), isNull(schema.memberAllianceTenure.leftAt)));
  const links = await db.select({ memberId: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(eq(schema.hqMemberLinks.allianceId, allianceId));
  const canonicalLinks = await db.select({ memberId: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders)
    .innerJoin(schema.commanderAllianceMemberships, eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId))
    .where(and(eq(schema.commanderAllianceMemberships.allianceId, allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
  const discord = await db.select({ memberId: schema.discordMemberLinks.ashedMemberId }).from(schema.discordMemberLinks).where(eq(schema.discordMemberLinks.allianceId, allianceId));
  const hqLinked = new Set([...links, ...canonicalLinks].map((row) => row.memberId));
  const discordLinked = new Set(discord.map((row) => row.memberId));
  return rows.map((row) => ({
    id: row.id, name: row.name, previousNames: row.previousNames ?? [], rank: row.rank,
    country: normalizeCountry(row.country), professionLevel: metric(row.professionLevel), baseLevel: metric(row.baseLevel),
    basePower: parseBasePower(row.basePower), kills: metric(row.kills), thp: metric(row.thp),
    tenureDays: continuousTenureDays(stints.filter((stint) => stint.memberId === row.id).map((stint) => stint.joinedAt.toISOString()), now),
    hqLinked: hqLinked.has(row.id), discordLinked: discordLinked.has(row.id),
  }));
}

export async function loadSupportStints(allianceId: string, db: SupportReader = getDb()): Promise<Record<string, string>> {
  const tenure = await db.select({ id: schema.memberAllianceTenure.id, memberId: schema.memberAllianceTenure.ashedMemberId, joinedAt: schema.memberAllianceTenure.joinedAt, leftAt: schema.memberAllianceTenure.leftAt })
    .from(schema.memberAllianceTenure).where(eq(schema.memberAllianceTenure.allianceId, allianceId));
  const memberships = await db.select({ id: schema.commanderAllianceMemberships.id, memberId: schema.commanderAllianceMemberships.ashedMemberId, joinedAt: schema.commanderAllianceMemberships.joinedAt, leftAt: schema.commanderAllianceMemberships.leftAt, status: schema.commanderAllianceMemberships.status })
    .from(schema.commanderAllianceMemberships).where(eq(schema.commanderAllianceMemberships.allianceId, allianceId));
  const result: Record<string, string> = {};
  const ids = new Set([...tenure, ...memberships].map((row) => row.memberId));
  for (const id of ids) {
    const history = tenure.filter((row) => row.memberId === id);
    const source = history.length ? history : memberships.filter((row) => row.memberId === id && row.status === "active");
    const open = source.filter((row) => row.leftAt === null);
    if (open.length !== 1 || !open[0].joinedAt || source.some((row) => row.leftAt && row.leftAt > open[0].joinedAt)) continue;
    result[id] = createHash("sha256").update(JSON.stringify([allianceId, id, history.length ? "tenure" : "membership", open[0].id, open[0].joinedAt.toISOString()])).digest("hex");
  }
  return result;
}

function parseBasePower(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!match) return null;
  return metric(Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() as "K" | "M" | "B"] ?? 1));
}
