import "server-only";

import { eq } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { loadSignInMethodSnapshot } from "@/lib/auth/account-linking.server";
import {
  resolveEmailSignInRestriction,
  type EmailSignInRestriction,
} from "@/lib/auth/email-sign-in-restriction.shared";
import { getDb, schema } from "@/lib/db";

export class EmailSignInRestrictedError extends Error {
  readonly code = "oauth_sign_in_required" as const;
  readonly restriction: Extract<EmailSignInRestriction, { blocked: true }>;

  constructor(restriction: Extract<EmailSignInRestriction, { blocked: true }>) {
    super("Email sign-in is disabled for OAuth-only accounts.");
    this.name = "EmailSignInRestrictedError";
    this.restriction = restriction;
  }
}

export async function resolveEmailSignInRestrictionForEmail(
  rawEmail: string,
): Promise<EmailSignInRestriction> {
  const email = normalizeAshedEmail(rawEmail);
  if (!email) {
    return { blocked: false };
  }

  const db = getDb();
  const [user] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  if (!user) {
    return { blocked: false };
  }

  const snapshot = await loadSignInMethodSnapshot(user.id);
  if (!snapshot) {
    return { blocked: false };
  }

  return resolveEmailSignInRestriction(snapshot);
}

export async function assertEmailSignInAllowed(rawEmail: string): Promise<void> {
  const restriction = await resolveEmailSignInRestrictionForEmail(rawEmail);
  if (restriction.blocked) {
    throw new EmailSignInRestrictedError(restriction);
  }
}
