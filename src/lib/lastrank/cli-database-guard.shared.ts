const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDatabaseHost(host: string): boolean {
  return LOCAL_DATABASE_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Writes to a non-local database require `--confirm-host <host>` matching the
 * resolved host, so a stray env var cannot silently target production.
 */
export function assertCliDatabaseHostConfirmed(input: {
  host: string;
  writes: boolean;
  confirmHost?: string;
}): void {
  const host = input.host.trim().toLowerCase();
  const confirm = input.confirmHost?.trim().toLowerCase();

  if (confirm && confirm !== host) {
    throw new Error(
      `--confirm-host "${input.confirmHost}" does not match the resolved database host "${input.host}".`,
    );
  }
  if (!input.writes || isLocalDatabaseHost(host) || confirm) return;

  throw new Error(
    `Refusing to write to remote database "${input.host}" without --confirm-host ${input.host}.`,
  );
}
