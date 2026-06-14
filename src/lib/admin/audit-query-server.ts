import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import { schema } from "@/lib/db";

import {
  escapeLikePrefix,
  normalizeAuditActionFilter,
  type AuditLogFilters,
} from "./audit-query";

const LIKE_ESCAPE = "\\";

export function buildAuditLogWhere(filters: AuditLogFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.allianceMatchIds?.length) {
    conditions.push(
      inArray(schema.auditLog.allianceId, filters.allianceMatchIds),
    );
  } else if (filters.allianceId) {
    conditions.push(eq(schema.auditLog.allianceId, filters.allianceId));
  }

  if (filters.hqUserId) {
    conditions.push(eq(schema.auditLog.hqUserId, filters.hqUserId));
  }

  if (filters.action) {
    const normalized = normalizeAuditActionFilter(filters.action);
    if (normalized.kind === "prefix") {
      const pattern = `${escapeLikePrefix(normalized.value)}%`;
      conditions.push(
        sql`${schema.auditLog.action} like ${pattern} escape ${LIKE_ESCAPE}`,
      );
    } else {
      conditions.push(eq(schema.auditLog.action, normalized.value));
    }
  }

  if (filters.since) {
    conditions.push(gte(schema.auditLog.createdAt, filters.since));
  }

  if (filters.until) {
    conditions.push(lte(schema.auditLog.createdAt, filters.until));
  }

  if (conditions.length === 0) {
    return undefined;
  }

  return and(...conditions);
}
