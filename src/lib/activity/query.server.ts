import "server-only";

import { createHash } from "node:crypto";

import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";

import {
  ActivityReadError,
  activityAllowedScopes,
  type ActivityPrincipal,
} from "./access.server";
import { activityCatalog } from "./catalog.shared";
import {
  ACTIVITY_SCOPES,
  type ActivityFeedFilters,
  type ActivityFeedHeadResponse,
  type ActivityFeedOptionsResponse,
  type ActivityFeedPage,
  type ActivityFeedScope,
} from "./feed.shared";
import {
  projectActivityRecord,
  safeActorKey,
  safeVisibleName,
} from "./projection.server";
import { ACTIVITY_CHANNELS, activityIdentifierSchema } from "./types.shared";

export type ActivityFeedQueryInput = ActivityFeedFilters & {
  view: "page" | "head" | "filters";
  limit: number;
  cursor?: string;
  q?: string;
};

const e = schema.activityEvents;

const cursorTime = sql<string>`to_char(${e.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function safeActorIdSql(column: SQLWrapper) {
  const id = sql`btrim(${column})`;
  return sql`${column} is not null
    and ${id} <> ''
    and char_length(${id}) <= 200
    and position('@' in ${id}) = 0
    and ${id} !~ '[[:space:]]'
    and ${id} !~ '^[0-9]{12,16}$'`;
}

const actorKey = sql<string | null>`case
  when ${e.originalHqUserId} is not null then
    case
      when ${safeActorIdSql(e.originalHqUserId)}
      then 'hq:' || btrim(${e.originalHqUserId})
      else null
    end
  when ${e.originalDiscordUserId} is not null then
    case
      when ${safeActorIdSql(e.originalDiscordUserId)}
      then 'discord:' || btrim(${e.originalDiscordUserId})
      else null
    end
  else null
end`;

function safeNameSql(column: SQLWrapper) {
  const value = sql<string>`left(btrim(${column}),160)`;
  return sql<
    string | null
  >`case when ${value} = '' or ${value} like '%@%' or ${value} ~ '[0-9]{12,16}' then null else ${value} end`;
}

const safeActorName = safeNameSql(e.actorDisplayName);
const safeAllianceTag = safeNameSql(e.allianceTag);
const safeAllianceName = safeNameSql(e.allianceName);
const safeServerNumber = sql<
  string | null
>`case when ${e.serverNumber} ~ '^[0-9]{1,8}$' then ${e.serverNumber} else null end`;

const cursorSchema = z
  .object({
    version: z.literal(1),
    scope: z.enum(ACTIVITY_SCOPES),
    scopeFence: z.string().max(1600),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    occurredAt: z
      .iso.datetime({ precision: 6 })
      .refine((value) => !value.startsWith("0000-")),
    id: activityIdentifierSchema,
  })
  .strict();

type ActivityCursor = z.infer<typeof cursorSchema>;

function filterKey(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
  query: ActivityFeedQueryInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope,
        principal.scopeFence,
        query.from ?? null,
        query.to ?? null,
        query.channel ?? null,
        query.category ?? null,
        query.kind ?? null,
        query.actor ?? null,
        query.allianceId ?? null,
        query.server ?? null,
      ]),
    )
    .digest("hex");
}

function parseCursor(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
  query: ActivityFeedQueryInput,
): ActivityCursor | undefined {
  if (query.cursor === undefined) {
    return undefined;
  }
  if (query.cursor.length > 1600) {
    throw new ActivityReadError("invalid", 400);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(query.cursor);
  } catch {
    throw new ActivityReadError("invalid", 400);
  }
  const parsed = cursorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ActivityReadError("invalid", 400);
  }
  const cursor = parsed.data;
  if (cursor.scope !== scope || cursor.scopeFence !== principal.scopeFence) {
    throw new ActivityReadError("forbidden", 403);
  }
  if (cursor.key !== filterKey(principal, scope, query)) {
    throw new ActivityReadError("invalid", 400);
  }
  return cursor;
}

function baseConditions(principal: ActivityPrincipal, scope: ActivityFeedScope) {
  // Global includes private event metadata; projection must strip actor, values, and details.
  return [
    eq(e.schemaVersion, 1),
    or(
      ...Object.entries(activityCatalog)
        .filter(
          ([, entry]) =>
            scope !== "alliance" || entry.visibility === "alliance",
        )
        .map(([key, entry]) =>
          and(
            eq(e.eventKey, key),
            eq(e.feature, entry.feature),
            eq(e.kind, entry.kind),
            eq(e.visibilityClass, entry.visibility),
          ),
        ),
    ),
    scope === "personal"
      ? eq(e.personalOwnerHqUserId, principal.hqUserId)
      : undefined,
    scope === "alliance"
      ? and(
          eq(e.allianceId, principal.currentAllianceId!),
          eq(e.visibilityClass, "alliance"),
        )
      : undefined,
  ];
}

function filterConditions(
  query: ActivityFeedQueryInput,
  scope: ActivityFeedScope,
) {
  return [
    query.from
      ? sql`${e.occurredAt} >= ${query.from}::text::timestamptz`
      : undefined,
    query.to
      ? sql`${e.occurredAt} < ${query.to}::text::timestamptz`
      : undefined,
    query.channel ? eq(e.channel, query.channel) : undefined,
    query.category ? eq(e.feature, query.category) : undefined,
    query.kind ? eq(e.kind, query.kind) : undefined,
    query.actor
      ? and(
          eq(actorKey, query.actor),
          scope === "global"
            ? eq(e.visibilityClass, "alliance")
            : undefined,
        )
      : undefined,
    query.allianceId ? eq(e.allianceId, query.allianceId) : undefined,
    query.server ? eq(e.serverNumber, query.server) : undefined,
  ];
}

function escapeIlikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function visibleActorOption(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const match = /^(hq|discord):(.*)$/.exec(value);
  if (!match) {
    return null;
  }
  return safeActorKey(match[1] as "hq" | "discord", match[2]);
}

function assertScopeAllowed(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
): void {
  if (!activityAllowedScopes(principal).includes(scope)) {
    throw new ActivityReadError("forbidden", 403);
  }
}

export async function queryActivityPage(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
  query: ActivityFeedQueryInput,
): Promise<ActivityFeedPage> {
  assertScopeAllowed(principal, scope);
  const cursor = parseCursor(principal, scope, query);
  const boundary = cursor
    ? sql`(${e.occurredAt}, ${e.id}) < (${cursor.occurredAt}::text::timestamptz, ${cursor.id})`
    : undefined;

  const rows = await getDb()
    .select({ record: e, cursorTime })
    .from(e)
    .where(
      and(
        ...baseConditions(principal, scope),
        ...filterConditions(query, scope),
        boundary,
      ),
    )
    .orderBy(desc(e.occurredAt), desc(e.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? JSON.stringify({
          version: 1,
          scope,
          scopeFence: principal.scopeFence,
          key: filterKey(principal, scope, query),
          occurredAt: last.cursorTime,
          id: last.record.id,
        } satisfies ActivityCursor)
      : null;

  const items = page.map((row) =>
    projectActivityRecord(
      { ...row.record, occurredAt: row.cursorTime },
      principal,
      scope,
    ),
  );

  return {
    items,
    nextCursor,
    head: items[0]
      ? { id: items[0].id, occurredAt: items[0].occurredAt }
      : null,
    scope,
    scopeFence: principal.scopeFence,
    allowedScopes: activityAllowedScopes(principal),
  };
}

export async function queryActivityHead(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
  query: ActivityFeedQueryInput,
): Promise<ActivityFeedHeadResponse> {
  assertScopeAllowed(principal, scope);
  const rows = await getDb()
    .select({ id: e.id, occurredAt: cursorTime })
    .from(e)
    .where(
      and(
        ...baseConditions(principal, scope),
        ...filterConditions(query, scope),
      ),
    )
    .orderBy(desc(e.occurredAt), desc(e.id))
    .limit(1);

  return {
    head: rows[0] ?? null,
    scope,
    scopeFence: principal.scopeFence,
    allowedScopes: activityAllowedScopes(principal),
  };
}

export async function queryActivityFilterOptions(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
  query: ActivityFeedQueryInput,
): Promise<ActivityFeedOptionsResponse> {
  assertScopeAllowed(principal, scope);
  const authorizedWhere = and(
    ...baseConditions(principal, scope),
    ...filterConditions(query, scope),
    scope === "global" ? eq(e.visibilityClass, "alliance") : undefined,
  );
  const pattern = query.q ? escapeIlikePattern(query.q) : undefined;
  const db = getDb();

  const [actors, alliances, servers] = await Promise.all([
    scope === "personal"
      ? Promise.resolve([])
      : db
          .selectDistinctOn([actorKey], {
            value: actorKey,
            label: safeActorName,
          })
          .from(e)
          .where(
            and(
              authorizedWhere,
              isNotNull(actorKey),
              pattern ? ilike(safeActorName, pattern) : undefined,
            ),
          )
          .orderBy(actorKey, desc(e.occurredAt), desc(e.id))
          .limit(100),
    scope === "alliance"
      ? Promise.resolve([])
      : db
          .selectDistinctOn([e.allianceId], {
            value: e.allianceId,
            tag: safeAllianceTag,
            name: safeAllianceName,
            serverNumber: safeServerNumber,
          })
          .from(e)
          .where(
            and(
              authorizedWhere,
              isNotNull(e.allianceId),
              pattern
                ? or(
                    ilike(safeAllianceTag, pattern),
                    ilike(safeAllianceName, pattern),
                    ilike(safeServerNumber, pattern),
                  )
                : undefined,
            ),
          )
          .orderBy(e.allianceId, desc(e.occurredAt), desc(e.id))
          .limit(100),
    scope !== "global"
      ? Promise.resolve([])
      : db
          .selectDistinct({ value: safeServerNumber })
          .from(e)
          .where(
            and(
              authorizedWhere,
              isNotNull(safeServerNumber),
              pattern ? ilike(safeServerNumber, pattern) : undefined,
            ),
          )
          .orderBy(safeServerNumber)
          .limit(100),
  ]);

  const visibleEntries = Object.values(activityCatalog).filter(
    (entry) => scope !== "alliance" || entry.visibility === "alliance",
  );

  return {
    options: {
      actors: actors.flatMap((actor) => {
        const value = visibleActorOption(actor.value);
        if (value === null) {
          return [];
        }
        return [{ value, label: safeVisibleName(actor.label) }];
      }),
      alliances: alliances
        .filter((alliance) => alliance.value !== null)
        .map((alliance) => ({
          id: alliance.value as string,
          tag: safeVisibleName(alliance.tag),
          name: safeVisibleName(alliance.name),
          serverNumber: alliance.serverNumber,
        })),
      servers: servers
        .map((server) => server.value)
        .filter((value): value is string => value !== null),
      categories: [...new Set(visibleEntries.map((entry) => entry.feature))],
      channels: [...ACTIVITY_CHANNELS],
      kinds: [...new Set(visibleEntries.map((entry) => entry.kind))],
    },
    scope,
    scopeFence: principal.scopeFence,
    allowedScopes: activityAllowedScopes(principal),
  };
}
