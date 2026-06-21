import type { Sql } from "./db";

/**
 * E2E helper mirroring {@link rebindAshedIdentityToSession} — keeps Playwright
 * fixtures on the same DB semantics as production rebind without importing
 * server-only modules into the e2e bundle.
 */
export async function rebindAshedIdentityForE2e(
  sql: Sql,
  input: {
    ashedUserId: string;
    canonicalHqUserId: string;
    sessionId: string;
    mergedFromHqUserId?: string | null;
    allianceId?: string | null;
  },
): Promise<{ revokedCredentialSessions: number; revokedMemberships: number }> {
  const now = new Date();
  const ashedUserId = input.ashedUserId.trim();

  const duplicateCredentials = await sql<
    { id: string; session_id: string }[]
  >`
    SELECT id, session_id
    FROM ashed_credentials
    WHERE ashed_user_id = ${ashedUserId}
      AND session_id <> ${input.sessionId}
  `;

  for (const cred of duplicateCredentials) {
    await sql`
      DELETE FROM ashed_credentials
      WHERE id = ${cred.id}
    `;
    await sql`
      UPDATE sessions
      SET alliance_id = NULL, alliance_tag = NULL, updated_at = ${now}
      WHERE id = ${cred.session_id}
    `;
  }

  let revokedMemberships = 0;
  if (
    input.mergedFromHqUserId &&
    input.mergedFromHqUserId !== input.canonicalHqUserId
  ) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM alliance_memberships
      WHERE hq_user_id = ${input.mergedFromHqUserId}
        AND source = 'ashed'
        AND status = 'active'
        ${input.allianceId ? sql`AND alliance_id = ${input.allianceId}` : sql``}
    `;

    for (const row of rows) {
      await sql`
        UPDATE alliance_memberships
        SET status = 'revoked', updated_at = ${now}
        WHERE id = ${row.id}
      `;
    }
    revokedMemberships = rows.length;
  }

  return {
    revokedCredentialSessions: duplicateCredentials.length,
    revokedMemberships,
  };
}
