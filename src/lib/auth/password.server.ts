import "server-only";

import { eq } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";

import {
  hashPassphrase,
  TIMING_SAFE_DUMMY_HASH,
  verifyPassphrase,
} from "./passphrase";
import { validatePasswordPair } from "./password.shared";

export class PasswordAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_email"
      | "invalid_password"
      | "email_taken"
      | "no_password"
      | "invalid_credentials"
      | "current_password_required"
      | "current_password_incorrect",
  ) {
    super(message);
    this.name = "PasswordAuthError";
  }
}

export async function setPasswordForHqUser(input: {
  hqUserId: string;
  password: string;
  confirmPassword: string;
  /** Required when the account already has a password (session alone is not enough). */
  currentPassword?: string;
}): Promise<void> {
  const passwordError = validatePasswordPair({
    password: input.password,
    confirmPassword: input.confirmPassword,
  });
  if (passwordError) {
    throw new PasswordAuthError("Invalid password.", "invalid_password");
  }

  const db = getDb();
  const [existing] = await db
    .select({
      id: schema.hqUsers.id,
      passwordHash: schema.hqUsers.passwordHash,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, input.hqUserId))
    .limit(1);

  if (!existing) {
    throw new PasswordAuthError("User not found.", "invalid_credentials");
  }

  if (existing.passwordHash) {
    const current = input.currentPassword ?? "";
    if (!current) {
      throw new PasswordAuthError(
        "Current password required.",
        "current_password_required",
      );
    }
    const ok = await verifyPassphrase(current, existing.passwordHash);
    if (!ok) {
      throw new PasswordAuthError(
        "Current password incorrect.",
        "current_password_incorrect",
      );
    }
  }

  const passwordHash = await hashPassphrase(input.password);
  const now = new Date();

  const updated = await db
    .update(schema.hqUsers)
    .set({
      passwordHash,
      updatedAt: now,
    })
    .where(eq(schema.hqUsers.id, input.hqUserId))
    .returning({ id: schema.hqUsers.id });

  if (updated.length === 0) {
    throw new PasswordAuthError("User not found.", "invalid_credentials");
  }
}

export async function verifyPasswordLogin(
  email: string,
  password: string,
): Promise<{
  id: string;
  email: string;
  displayName: string | null;
} | null> {
  const normalized = normalizeAshedEmail(email);
  if (!normalized || !password) {
    return null;
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      passwordHash: schema.hqUsers.passwordHash,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  const hashToVerify = row?.passwordHash ?? TIMING_SAFE_DUMMY_HASH;
  const ok = await verifyPassphrase(password, hashToVerify);
  if (!row?.passwordHash || !ok) {
    return null;
  }

  const now = new Date();
  await db
    .update(schema.hqUsers)
    .set({
      emailVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.hqUsers.id, row.id));

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
  };
}

export async function hqUserHasPassword(hqUserId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ passwordHash: schema.hqUsers.passwordHash })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return Boolean(row?.passwordHash);
}

