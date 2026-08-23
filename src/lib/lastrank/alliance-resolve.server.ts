import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";
import type { LastRankSyncTarget } from "@/lib/lastrank/sync-registry.shared";
import { createNativeAlliance } from "@/lib/native-alliance/provision";
import { stringSimilarity } from "@/lib/video/member-matcher";

export type HqAllianceCandidate = {
  id: string;
  tag: string | null;
  name: string;
  gameServerNumber: number;
  score: number | null;
};

export type LastRankAllianceResolvePrompt = (ctx: {
  target: LastRankSyncTarget;
  exactMatches: HqAllianceCandidate[];
  fuzzyMatches: HqAllianceCandidate[];
}) => Promise<"create" | string>;

const LASTRANK_TAG_FUZZY_MIN = 0.72;

export async function listHqAllianceCandidates(
  gameServerNumber: number,
  tag: string,
): Promise<{ exact: HqAllianceCandidate[]; fuzzy: HqAllianceCandidate[] }> {
  const db = getDb();
  const needle = tag.trim().toLowerCase();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.gameServerNumber, Math.floor(gameServerNumber)));

  const exact: HqAllianceCandidate[] = [];
  const fuzzy: HqAllianceCandidate[] = [];

  for (const row of rows) {
    const rowTag = row.tag?.trim() ?? "";
    if (!rowTag) continue;
    if (rowTag.toLowerCase() === needle) {
      exact.push({
        id: row.id,
        tag: row.tag,
        name: row.name,
        gameServerNumber: row.gameServerNumber,
        score: 1,
      });
      continue;
    }
    const score = stringSimilarity(
      normalizeCommanderName(tag),
      normalizeCommanderName(rowTag),
    );
    if (score >= LASTRANK_TAG_FUZZY_MIN) {
      fuzzy.push({
        id: row.id,
        tag: row.tag,
        name: row.name,
        gameServerNumber: row.gameServerNumber,
        score,
      });
    }
  }

  fuzzy.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { exact, fuzzy };
}

export async function resolveHqAllianceForLastRankSync(input: {
  target: LastRankSyncTarget;
  allowCreate: boolean;
  alliancePrompt?: LastRankAllianceResolvePrompt;
}): Promise<{ allianceId: string; created: boolean }> {
  const { exact, fuzzy } = await listHqAllianceCandidates(
    input.target.gameServerNumber,
    input.target.tag,
  );

  if (exact.length === 1) {
    return { allianceId: exact[0].id, created: false };
  }
  if (exact.length > 1) {
    throw new Error(
      `Multiple HQ alliances on server ${input.target.gameServerNumber} share tag ${input.target.tag}.`,
    );
  }

  const fuzzyUnique = fuzzy.filter(
    (row, index, all) => all.findIndex((other) => other.id === row.id) === index,
  );

  if (fuzzyUnique.length > 0 && input.alliancePrompt) {
    const choice = await input.alliancePrompt({
      target: input.target,
      exactMatches: exact,
      fuzzyMatches: fuzzyUnique,
    });
    if (choice !== "create") {
      return { allianceId: choice, created: false };
    }
  } else if (fuzzyUnique.length === 1 && !input.allowCreate) {
    return { allianceId: fuzzyUnique[0].id, created: false };
  } else if (fuzzyUnique.length > 1 && !input.alliancePrompt) {
    throw new Error(
      `Tag ${input.target.tag} on server ${input.target.gameServerNumber} fuzzy-matches multiple HQ alliances: ${fuzzyUnique.map((r) => r.tag).join(", ")}. Re-run with --interactive.`,
    );
  }

  if (!input.allowCreate) {
    throw new Error(
      `No HQ alliance for server ${input.target.gameServerNumber} tag ${input.target.tag}. Re-run with --apply to create.`,
    );
  }

  const created = await createNativeAlliance({
    name: input.target.tag,
    tag: input.target.tag,
    gameServerNumber: input.target.gameServerNumber,
  });
  return { allianceId: created.allianceId, created: true };
}

export async function findHqAllianceIdByTagOnServer(
  tag: string,
  gameServerNumber: number,
): Promise<string | null> {
  const db = getDb();
  const needle = tag.trim().toLowerCase();
  const rows = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(
      and(
        eq(schema.alliances.gameServerNumber, Math.floor(gameServerNumber)),
        sql`lower(${schema.alliances.tag}) = ${needle}`,
      ),
    )
    .limit(2);
  if (rows.length === 1) return rows[0].id;
  return null;
}
