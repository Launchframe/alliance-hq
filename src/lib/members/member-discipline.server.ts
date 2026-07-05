import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { forwardJson } from "@/lib/bff/session";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  hasDisciplineUpsertKey,
  parseAshedDisciplineRecord,
  shouldSkipAshedUpsertForManualRow,
} from "@/lib/members/member-discipline.shared";

type AshedRecord = Record<string, unknown>;

async function fetchAshedEntityList(
  connection: ParsedConnection,
  entity: string,
  memberId: string,
): Promise<AshedRecord[]> {
  try {
    const query = new URLSearchParams({ member_id: memberId });
    const upstream = await forwardJson(
      connection,
      `/entities/${entity}?${query.toString()}`,
      { method: "GET" },
    );
    if (!upstream.ok) return [];
    const body = (await upstream.json()) as unknown;
    if (Array.isArray(body)) return body as AshedRecord[];
    if (
      body &&
      typeof body === "object" &&
      Array.isArray((body as AshedRecord).items)
    ) {
      return (body as AshedRecord).items as AshedRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

async function upsertCommendationRow(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  parsed: ReturnType<typeof parseAshedDisciplineRecord>;
}) {
  const db = getDb();
  const now = new Date();
  const { parsed } = input;

  if (!hasDisciplineUpsertKey(parsed)) return;

  let existingId: string | null = null;
  let matchedByAshedId = false;
  if (parsed.ashedId) {
    const [byAshedId] = await db
      .select({ id: schema.memberCommendations.id })
      .from(schema.memberCommendations)
      .where(
        and(
          eq(schema.memberCommendations.allianceId, input.allianceId),
          eq(schema.memberCommendations.ashedCommendationId, parsed.ashedId),
        ),
      )
      .limit(1);
    existingId = byAshedId?.id ?? null;
    matchedByAshedId = existingId != null;
  }

  if (!existingId && parsed.recordedDate) {
    const typeClause = parsed.type
      ? eq(schema.memberCommendations.commendationType, parsed.type)
      : isNull(schema.memberCommendations.commendationType);
    const [byNaturalKey] = await db
      .select({
        id: schema.memberCommendations.id,
        ashedCommendationId: schema.memberCommendations.ashedCommendationId,
      })
      .from(schema.memberCommendations)
      .where(
        and(
          eq(schema.memberCommendations.allianceId, input.allianceId),
          eq(schema.memberCommendations.ashedMemberId, input.ashedMemberId),
          eq(schema.memberCommendations.recordedDate, parsed.recordedDate),
          typeClause,
        ),
      )
      .limit(1);
    if (
      byNaturalKey &&
      shouldSkipAshedUpsertForManualRow({
        matchedByAshedId,
        existingAshedId: byNaturalKey.ashedCommendationId,
      })
    ) {
      return;
    }
    existingId = byNaturalKey?.id ?? null;
  }

  const values = {
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    commendationType: parsed.type,
    notes: parsed.notes,
    recordedDate: parsed.recordedDate,
    ashedCommendationId: parsed.ashedId,
    updatedAt: now,
  };

  if (existingId) {
    await db
      .update(schema.memberCommendations)
      .set(values)
      .where(eq(schema.memberCommendations.id, existingId));
    return;
  }

  await db.insert(schema.memberCommendations).values({
    id: nanoid(),
    ...values,
    createdAt: now,
  });
}

async function upsertViolationRow(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  parsed: ReturnType<typeof parseAshedDisciplineRecord>;
}) {
  const db = getDb();
  const now = new Date();
  const { parsed } = input;

  if (!hasDisciplineUpsertKey(parsed)) return;

  let existingId: string | null = null;
  let matchedByAshedId = false;
  if (parsed.ashedId) {
    const [byAshedId] = await db
      .select({ id: schema.memberViolations.id })
      .from(schema.memberViolations)
      .where(
        and(
          eq(schema.memberViolations.allianceId, input.allianceId),
          eq(schema.memberViolations.ashedViolationId, parsed.ashedId),
        ),
      )
      .limit(1);
    existingId = byAshedId?.id ?? null;
    matchedByAshedId = existingId != null;
  }

  if (!existingId && parsed.recordedDate) {
    const typeClause = parsed.type
      ? eq(schema.memberViolations.violationType, parsed.type)
      : isNull(schema.memberViolations.violationType);
    const [byNaturalKey] = await db
      .select({
        id: schema.memberViolations.id,
        ashedViolationId: schema.memberViolations.ashedViolationId,
      })
      .from(schema.memberViolations)
      .where(
        and(
          eq(schema.memberViolations.allianceId, input.allianceId),
          eq(schema.memberViolations.ashedMemberId, input.ashedMemberId),
          eq(schema.memberViolations.recordedDate, parsed.recordedDate),
          typeClause,
        ),
      )
      .limit(1);
    if (
      byNaturalKey &&
      shouldSkipAshedUpsertForManualRow({
        matchedByAshedId,
        existingAshedId: byNaturalKey.ashedViolationId,
      })
    ) {
      return;
    }
    existingId = byNaturalKey?.id ?? null;
  }

  const values = {
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    violationType: parsed.type,
    notes: parsed.notes,
    recordedDate: parsed.recordedDate,
    ashedViolationId: parsed.ashedId,
    expungedAt: parsed.expungedAt,
    updatedAt: now,
  };

  if (existingId) {
    await db
      .update(schema.memberViolations)
      .set(values)
      .where(eq(schema.memberViolations.id, existingId));
    return;
  }

  await db.insert(schema.memberViolations).values({
    id: nanoid(),
    ...values,
    createdAt: now,
  });
}

export async function syncMemberCommendationsFromAshed(
  connection: ParsedConnection,
  allianceId: string,
  ashedMemberId: string,
  memberName: string,
): Promise<void> {
  const rows = await fetchAshedEntityList(connection, "Commendation", ashedMemberId);
  for (const row of rows) {
    const parsed = parseAshedDisciplineRecord(row, "commendation");
    if (!hasDisciplineUpsertKey(parsed)) {
      continue;
    }
    await upsertCommendationRow({
      allianceId,
      ashedMemberId,
      memberName,
      parsed,
    });
  }
}

export async function syncMemberViolationsFromAshed(
  connection: ParsedConnection,
  allianceId: string,
  ashedMemberId: string,
  memberName: string,
): Promise<void> {
  const rows = await fetchAshedEntityList(connection, "Violation", ashedMemberId);
  for (const row of rows) {
    const parsed = parseAshedDisciplineRecord(row, "violation");
    if (!hasDisciplineUpsertKey(parsed)) {
      continue;
    }
    await upsertViolationRow({
      allianceId,
      ashedMemberId,
      memberName,
      parsed,
    });
  }
}
