type PostgresLikeError = Error & { code?: string };

/** Walk Error.cause chains and postgres.js/Drizzle wrappers for diagnostics. */
export function collectDatabaseErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message.trim()) {
      parts.push(current.message.trim());
    }
    const pg = current as PostgresLikeError;
    if (pg.code) {
      parts.push(`postgres:${pg.code}`);
    }
    current = current.cause;
  }

  if (typeof error === "string" && error.trim()) {
    parts.push(error.trim());
  }

  return parts.join("\n");
}

export function postgresErrorCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const pg = current as PostgresLikeError;
    if (pg.code) {
      return pg.code;
    }
    current = current.cause;
  }

  return null;
}

export function isPostgresAuthError(error: unknown): boolean {
  return postgresErrorCode(error) === "28P01";
}

export function isConnectionPoolExhausted(error: unknown): boolean {
  const text = collectDatabaseErrorText(error);
  return text.includes("53300") || /too many clients already/i.test(text);
}

export function isMissingSchemaError(error: unknown): boolean {
  const text = collectDatabaseErrorText(error);
  return (
    /relation "[^"]+" does not exist/i.test(text) ||
    /column "[^"]+" does not exist/i.test(text)
  );
}

export function isEncryptionKeyError(error: unknown): boolean {
  const text = collectDatabaseErrorText(error);
  return (
    text.includes("TOKEN_ENCRYPTION_KEY") ||
    /unable to authenticate data/i.test(text) ||
    text.includes("Invalid encrypted payload format")
  );
}

export type DatabaseErrorPresentation = {
  titleKey:
    | "databaseNotConfigured"
    | "serviceUnavailable"
    | "connectionPoolExhausted";
  hintKey:
    | "localDatabaseUrl"
    | "tokenEncryptionKey"
    | "tablesMissing"
    | "postgresUnreachable"
    | "connectionPoolExhaustedHint"
    | "schemaMigrationHint"
    | "encryptionKeyMismatchHint"
    | "defaultHint"
    | "productionDetail";
  /** Shown in development when no mapped hint applies — raw error excerpt. */
  devDetail?: string;
};

export function resolveDatabaseErrorPresentation(
  error: unknown,
): DatabaseErrorPresentation {
  const text = collectDatabaseErrorText(error);

  if (text.includes("LOCAL_DATABASE_URL") || text.includes("DATABASE_URL")) {
    return { titleKey: "databaseNotConfigured", hintKey: "localDatabaseUrl" };
  }
  if (isEncryptionKeyError(error)) {
    if (text.includes("TOKEN_ENCRYPTION_KEY")) {
      return { titleKey: "databaseNotConfigured", hintKey: "tokenEncryptionKey" };
    }
    return {
      titleKey: "serviceUnavailable",
      hintKey: "encryptionKeyMismatchHint",
    };
  }
  if (text.includes('relation "sessions" does not exist')) {
    return { titleKey: "databaseNotConfigured", hintKey: "tablesMissing" };
  }
  if (isMissingSchemaError(error)) {
    return { titleKey: "serviceUnavailable", hintKey: "schemaMigrationHint" };
  }
  if (isConnectionPoolExhausted(error)) {
    return {
      titleKey: "connectionPoolExhausted",
      hintKey: "connectionPoolExhaustedHint",
    };
  }
  if (text.includes("ECONNREFUSED") || text.includes("ECONNRESET")) {
    return { titleKey: "databaseNotConfigured", hintKey: "postgresUnreachable" };
  }

  if (process.env.NODE_ENV === "development") {
    return {
      titleKey: "databaseNotConfigured",
      hintKey: "defaultHint",
      devDetail: text.slice(0, 800),
    };
  }

  return { titleKey: "serviceUnavailable", hintKey: "productionDetail" };
}
