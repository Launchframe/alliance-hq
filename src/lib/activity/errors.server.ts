import "server-only";

import { randomUUID } from "node:crypto";

import { postgresErrorCode } from "@/lib/db/error-message";

import { isActivityEventKey, type ActivityEventKey } from "./catalog.shared";

export type ActivityFailureCategory =
  | "validation"
  | "missing_schema"
  | "permission"
  | "constraint"
  | "connection"
  | "idempotency_conflict"
  | "unknown";

const SQLSTATE_PATTERN = /^[A-Z0-9]{5}$/;

export function sanitizeActivitySqlState(value: unknown): string | null {
  return typeof value === "string" && SQLSTATE_PATTERN.test(value)
    ? value
    : null;
}

export function classifyActivitySqlState(
  sqlState: string | null,
): ActivityFailureCategory {
  if (sqlState === "42P01" || sqlState === "42703") {
    return "missing_schema";
  }
  if (sqlState === "42501") {
    return "permission";
  }
  if (sqlState?.startsWith("23")) {
    return "constraint";
  }
  if (sqlState?.startsWith("08")) {
    return "connection";
  }
  return "unknown";
}

export class ActivityWriteError extends Error {
  readonly eventKey: ActivityEventKey | "unknown";
  readonly failureCategory: ActivityFailureCategory;
  readonly sqlState: string | null;
  readonly incidentId: string;

  constructor(init: {
    eventKey: unknown;
    failureCategory: ActivityFailureCategory;
    sqlState?: string | null;
  }) {
    super("activity_write_failed");
    this.name = "ActivityWriteError";
    this.eventKey = isActivityEventKey(init.eventKey)
      ? init.eventKey
      : "unknown";
    this.failureCategory = init.failureCategory;
    this.sqlState = sanitizeActivitySqlState(init.sqlState);
    this.incidentId = randomUUID();
  }
}

export function toActivityWriteError(
  error: unknown,
  eventKey: unknown,
): ActivityWriteError {
  if (error instanceof ActivityWriteError) {
    return error;
  }
  const sqlState = sanitizeActivitySqlState(postgresErrorCode(error));
  return new ActivityWriteError({
    eventKey,
    failureCategory: classifyActivitySqlState(sqlState),
    sqlState,
  });
}
