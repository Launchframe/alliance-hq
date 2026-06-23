import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

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
      | "invalid_credentials",
  ) {
    super(message);
    this.name = "PasswordAuthError";
  }
}

export async function setPasswordForHqUser(input: {
  hqUserId: string;
  password: string;
  confirmPassword: string;
}): Promise<void> {
  const passwordError = validatePasswordPair({
    password: input.password,
    confirmPassword: input.confirmPassword,
  });
  if (passwordError) {
    throw new PasswordAuthError("Invalid password.", "invalid_password");
  }

  const db = getDb();
  const passwordHash = await hashPassphrase(input.password);
  const now = new Date();

  await db
    .update(schema.hqUsers)
    .set({
      passwordHash,
      updatedAt: now,
    })
    .where(eq(schema.hqUsers.id, input.hqUserId));
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

export async function registerPasswordAccount(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<{ id: string; email: string; displayName: string | null }> {
  const normalized = normalizeAshedEmail(input.email);
  if (!normalized) {
    throw new PasswordAuthError("Invalid email.", "invalid_email");
  }

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
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      passwordHash: schema.hqUsers.passwordHash,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (existing?.passwordHash) {
    throw new PasswordAuthError("Email already registered.", "email_taken");
  }

  const passwordHash = await hashPassphrase(input.password);
  const now = new Date();

  if (existing) {
    await db
      .update(schema.hqUsers)
      .set({
        passwordHash,
        emailVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, existing.id));
    return {
      id: existing.id,
      email: existing.email,
      displayName: existing.displayName,
    };
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email: normalized,
    displayName: null,
    passwordHash,
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return { id, email: normalized, displayName: null };
}
