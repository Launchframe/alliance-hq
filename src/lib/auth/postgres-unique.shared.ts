/** Postgres unique_violation SQLSTATE. */
export const POSTGRES_UNIQUE_VIOLATION = "23505";

export function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

export function readPostgresConstraintName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" && constraint.trim()
    ? constraint.trim()
    : null;
}
