import "server-only";

import type {
  Adapter,
  AdapterAccount,
  AdapterAuthenticator,
  AdapterUser,
} from "@auth/core/adapters";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { normalizeOAuthProviderEmail } from "@/lib/auth/account-linking.shared";

function toAdapterUser(row: typeof schema.hqUsers.$inferSelect): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt,
    name: row.displayName,
    image: row.avatarUrl,
  };
}

function toAdapterAccount(
  row: typeof schema.hqAuthAccounts.$inferSelect,
): AdapterAccount {
  return {
    id: row.id,
    userId: row.hqUserId,
    type: row.type as AdapterAccount["type"],
    provider: row.provider,
    providerAccountId: row.providerAccountId,
  };
}

export function createHqAuthAdapter(): Adapter {
  return {
    async createUser(data) {
      const db = getDb();
      const email = normalizeAshedEmail(data.email ?? "");
      if (!email) {
        throw new Error("Email is required to create an HQ user.");
      }
      const now = new Date();
      const id = nanoid(16);
      await db.insert(schema.hqUsers).values({
        id,
        email,
        displayName: data.name?.trim() || null,
        emailVerifiedAt: data.emailVerified ?? null,
        createdAt: now,
        updatedAt: now,
      });
      const [row] = await db
        .select()
        .from(schema.hqUsers)
        .where(eq(schema.hqUsers.id, id))
        .limit(1);
      if (!row) {
        throw new Error("Failed to create HQ user.");
      }
      return toAdapterUser(row);
    },

    async getUser(id) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.hqUsers)
        .where(eq(schema.hqUsers.id, id))
        .limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByEmail(email) {
      const normalized = normalizeAshedEmail(email);
      if (!normalized) return null;
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.hqUsers)
        .where(eq(schema.hqUsers.email, normalized))
        .limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const db = getDb();
      const [accountRow] = await db
        .select()
        .from(schema.hqAuthAccounts)
        .where(
          and(
            eq(schema.hqAuthAccounts.provider, provider),
            eq(schema.hqAuthAccounts.providerAccountId, providerAccountId),
          ),
        )
        .limit(1);
      if (!accountRow) {
        return null;
      }
      const [userRow] = await db
        .select()
        .from(schema.hqUsers)
        .where(eq(schema.hqUsers.id, accountRow.hqUserId))
        .limit(1);
      return userRow ? toAdapterUser(userRow) : null;
    },

    async getAccount(providerAccountId, provider) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.hqAuthAccounts)
        .where(
          and(
            eq(schema.hqAuthAccounts.provider, provider),
            eq(schema.hqAuthAccounts.providerAccountId, providerAccountId),
          ),
        )
        .limit(1);
      return row ? toAdapterAccount(row) : null;
    },

    async updateUser(data) {
      const db = getDb();
      const now = new Date();
      await db
        .update(schema.hqUsers)
        .set({
          ...(data.name !== undefined
            ? { displayName: data.name?.trim() || null }
            : {}),
          ...(data.email !== undefined
            ? { email: normalizeAshedEmail(data.email) }
            : {}),
          ...(data.emailVerified !== undefined
            ? { emailVerifiedAt: data.emailVerified }
            : {}),
          ...(data.image !== undefined ? { avatarUrl: data.image } : {}),
          updatedAt: now,
        })
        .where(eq(schema.hqUsers.id, data.id));
      const [row] = await db
        .select()
        .from(schema.hqUsers)
        .where(eq(schema.hqUsers.id, data.id))
        .limit(1);
      if (!row) {
        throw new Error("User not found.");
      }
      return toAdapterUser(row);
    },

    async deleteUser(userId) {
      const db = getDb();
      await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, userId));
    },

    async linkAccount(account) {
      const db = getDb();
      const id = String(account.id ?? nanoid(16));
      const extended = account as AdapterAccount & {
        providerEmail?: string | null;
      };
      await db.insert(schema.hqAuthAccounts).values({
        id,
        hqUserId: String(account.userId),
        type: String(account.type),
        provider: String(account.provider),
        providerAccountId: String(account.providerAccountId),
        providerEmail: normalizeOAuthProviderEmail(extended.providerEmail),
      });
      return { ...account, id };
    },

    async unlinkAccount({ provider, providerAccountId }) {
      const db = getDb();
      const [row] = await db
        .delete(schema.hqAuthAccounts)
        .where(
          and(
            eq(schema.hqAuthAccounts.provider, provider),
            eq(schema.hqAuthAccounts.providerAccountId, providerAccountId),
          ),
        )
        .returning();
      return row ? toAdapterAccount(row) : undefined;
    },

    async createVerificationToken(data) {
      const db = getDb();
      await db.insert(schema.authVerificationTokens).values({
        identifier: data.identifier,
        token: data.token,
        expires: data.expires,
      });
      return data;
    },

    async useVerificationToken({ identifier, token }) {
      const db = getDb();
      const [match] = await db
        .select()
        .from(schema.authVerificationTokens)
        .where(
          and(
            eq(schema.authVerificationTokens.identifier, identifier),
            eq(schema.authVerificationTokens.token, token),
          ),
        )
        .limit(1);

      if (!match) {
        return null;
      }

      await db
        .delete(schema.authVerificationTokens)
        .where(
          and(
            eq(schema.authVerificationTokens.identifier, identifier),
            eq(schema.authVerificationTokens.token, token),
          ),
        );

      return {
        identifier: match.identifier,
        token: match.token,
        expires: match.expires,
      };
    },

    async createAuthenticator(data: AdapterAuthenticator) {
      const db = getDb();
      await db.insert(schema.hqAuthenticators).values({
        credentialID: data.credentialID,
        hqUserId: data.userId,
        providerAccountId: data.providerAccountId,
        credentialPublicKey: data.credentialPublicKey,
        counter: data.counter,
        credentialDeviceType: data.credentialDeviceType,
        credentialBackedUp: data.credentialBackedUp,
        transports: data.transports ?? null,
      });
      return data;
    },

    async getAuthenticator(credentialID: string) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.hqAuthenticators)
        .where(eq(schema.hqAuthenticators.credentialID, credentialID))
        .limit(1);
      if (!row) {
        return null;
      }
      return {
        credentialID: row.credentialID,
        userId: row.hqUserId,
        providerAccountId: row.providerAccountId,
        credentialPublicKey: row.credentialPublicKey,
        counter: row.counter,
        credentialDeviceType: row.credentialDeviceType,
        credentialBackedUp: row.credentialBackedUp,
        transports: row.transports ?? undefined,
      };
    },

    async listAuthenticatorsByUserId(userId: string) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.hqAuthenticators)
        .where(eq(schema.hqAuthenticators.hqUserId, userId));
      return rows.map((row) => ({
        credentialID: row.credentialID,
        userId: row.hqUserId,
        providerAccountId: row.providerAccountId,
        credentialPublicKey: row.credentialPublicKey,
        counter: row.counter,
        credentialDeviceType: row.credentialDeviceType,
        credentialBackedUp: row.credentialBackedUp,
        transports: row.transports ?? undefined,
      }));
    },

    async updateAuthenticatorCounter(credentialID: string, newCounter: number) {
      const db = getDb();
      const [row] = await db
        .update(schema.hqAuthenticators)
        .set({ counter: newCounter })
        .where(eq(schema.hqAuthenticators.credentialID, credentialID))
        .returning();
      if (!row) {
        throw new Error("Authenticator not found.");
      }
      return {
        credentialID: row.credentialID,
        userId: row.hqUserId,
        providerAccountId: row.providerAccountId,
        credentialPublicKey: row.credentialPublicKey,
        counter: row.counter,
        credentialDeviceType: row.credentialDeviceType,
        credentialBackedUp: row.credentialBackedUp,
        transports: row.transports ?? undefined,
      };
    },
  };
}
