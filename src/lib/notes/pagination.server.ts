import "server-only";

import { asc, desc, sql, type SQLWrapper } from "drizzle-orm";
import type { KnowledgeActor } from "./policy.shared";
import { knowledgeHash } from "./mutations.server";
import { KnowledgeAccessError } from "./resources.server";
import { KNOWLEDGE_PAGE_SIZE, resourceCursorSchema, type ResourceCursor, type ResourcePage } from "./pagination.shared";

export function resourcePaging(actor: KnowledgeActor, identity: unknown[], raw: string | null = null) {
  if (actor.kind !== "web" || !actor.hqUserId) throw new KnowledgeAccessError("forbidden");
  const scope = `${actor.allianceId}:${actor.hqUserId}`, key = knowledgeHash(identity);
  let cursor: ResourceCursor | null = null;
  try { if (raw !== null) { if (raw.length > 1000) throw new Error(); cursor = resourceCursorSchema.parse(JSON.parse(raw)); } }
  catch { throw new KnowledgeAccessError("invalid"); }
  if (cursor && cursor.scope !== scope) throw new KnowledgeAccessError("forbidden");
  if (cursor && cursor.key !== key) throw new KnowledgeAccessError("invalid");
  const backwards = cursor?.direction === "previous";
  return { scope, key, cursor, backwards, order: backwards ? asc : desc, comparison: backwards ? sql`>` : sql`<` };
}
export function timePageBoundary(page: ReturnType<typeof resourcePaging>, timestamp: SQLWrapper, id: SQLWrapper) {
  if (!page.cursor) return undefined;
  if (typeof page.cursor.position !== "string") throw new KnowledgeAccessError("invalid");
  return sql`(${timestamp}, ${id}) ${page.comparison} (${page.cursor.position}::text::timestamptz, ${page.cursor.id})`;
}
export function resourcePage<T>(rows: T[], page: ReturnType<typeof resourcePaging>, position: (row: T) => Pick<ResourceCursor, "id" | "position">): ResourcePage<T> {
  const items = rows.slice(0, KNOWLEDGE_PAGE_SIZE);
  if (page.backwards) items.reverse();
  const cursor = (row: T | undefined, direction: ResourceCursor["direction"]) => row ? JSON.stringify({ version: 1, scope: page.scope, key: page.key, ...position(row), direction } satisfies ResourceCursor) : null;
  return { items, scope: page.scope,
    nextCursor: (page.backwards ? !!page.cursor : rows.length > KNOWLEDGE_PAGE_SIZE) ? cursor(items.at(-1), "next") : null,
    previousCursor: (page.backwards ? rows.length > KNOWLEDGE_PAGE_SIZE : !!page.cursor) ? cursor(items[0], "previous") : null,
  };
}
