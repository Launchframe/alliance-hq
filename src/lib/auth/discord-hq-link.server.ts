import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import {
  deleteDiscordHqLinkForHqUser,
  upsertDiscordHqLink,
} from "@/lib/vr/repository";
import { unlinkOAuthProviderForUser } from "@/lib/auth/account-linking.server";

export type CompleteDiscordBotHqLinkResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_nonce"
        | "expired_nonce"
        | "wrong_purpose"
        | "not_signed_in"
        | "no_discord_oauth"
        | "discord_mismatch";
    };

/** Web Discord OAuth — same identity the VR bot uses (`discord_hq_links`). */
export async function syncDiscordHqLinkFromOAuthSignIn(input: {
  discordUserId: string;
  hqUserId: string;
}): Promise<void> {
  const discordUserId = input.discordUserId.trim();
  const hqUserId = input.hqUserId.trim();
  if (!discordUserId || !hqUserId) {
    return;
  }

  const db = getDb();
  await db
    .delete(schema.discordHqLinks)
    .where(
      and(
        eq(schema.discordHqLinks.hqUserId, hqUserId),
        ne(schema.discordHqLinks.discordUserId, discordUserId),
      ),
    );

  await upsertDiscordHqLink({ discordUserId, hqUserId });
}

export async function getDiscordProviderAccountIdForHqUser(
  hqUserId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ providerAccountId: schema.hqAuthAccounts.providerAccountId })
    .from(schema.hqAuthAccounts)
    .where(
      and(
        eq(schema.hqAuthAccounts.hqUserId, hqUserId),
        eq(schema.hqAuthAccounts.provider, "discord"),
      ),
    )
    .limit(1);
  return row?.providerAccountId ?? null;
}

/** Completes `/link` after Discord OAuth — nonce must match the slash-command caller. */
export async function completeDiscordBotHqLink(input: {
  nonce: string;
  hqUserId: string;
}): Promise<CompleteDiscordBotHqLinkResult> {
  const nonce = input.nonce.trim();
  if (!nonce) {
    return { ok: false, reason: "missing_nonce" };
  }

  const nonceRow = await getValidDiscordAuthNonce(nonce);
  if (!nonceRow) {
    return { ok: false, reason: "expired_nonce" };
  }
  if (nonceRow.purpose !== "user_link") {
    return { ok: false, reason: "wrong_purpose" };
  }

  const hqUserId = input.hqUserId.trim();
  if (!hqUserId) {
    return { ok: false, reason: "not_signed_in" };
  }

  const discordAccountId = await getDiscordProviderAccountIdForHqUser(hqUserId);
  if (!discordAccountId) {
    return { ok: false, reason: "no_discord_oauth" };
  }

  if (discordAccountId !== nonceRow.discordUserId) {
    return { ok: false, reason: "discord_mismatch" };
  }

  await syncDiscordHqLinkFromOAuthSignIn({
    discordUserId: discordAccountId,
    hqUserId,
  });
  await consumeDiscordAuthNonce(nonceRow.id);
  return { ok: true };
}

/** Account settings or post-OAuth sync — no bot nonce required. */
export async function syncDiscordHqLinkFromSignedInUser(
  hqUserId: string,
): Promise<{ ok: true } | { ok: false; reason: "no_discord_oauth" }> {
  const trimmed = hqUserId.trim();
  if (!trimmed) {
    return { ok: false, reason: "no_discord_oauth" };
  }

  const discordAccountId = await getDiscordProviderAccountIdForHqUser(trimmed);
  if (!discordAccountId) {
    return { ok: false, reason: "no_discord_oauth" };
  }

  await syncDiscordHqLinkFromOAuthSignIn({
    discordUserId: discordAccountId,
    hqUserId: trimmed,
  });
  return { ok: true };
}

export type UnlinkDiscordHqLinkResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_linked" | "last_sign_in_method" | "oauth_unlink_failed";
    };

/** Removes bot `discord_hq_links` row and Discord OAuth when allowed. */
export async function unlinkDiscordHqLinkForUser(
  hqUserId: string,
): Promise<UnlinkDiscordHqLinkResult> {
  const trimmed = hqUserId.trim();
  if (!trimmed) {
    return { ok: false, reason: "not_linked" };
  }

  const hadBotLink = await deleteDiscordHqLinkForHqUser(trimmed);
  const oauthResult = await unlinkOAuthProviderForUser({
    hqUserId: trimmed,
    provider: "discord",
  });

  if (oauthResult.ok) {
    return { ok: true };
  }

  if (hadBotLink) {
    return { ok: true };
  }

  if (oauthResult.code === "last_method") {
    return { ok: false, reason: "last_sign_in_method" };
  }

  return { ok: false, reason: "not_linked" };
}
