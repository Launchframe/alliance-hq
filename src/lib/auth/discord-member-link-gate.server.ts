import "server-only";

import {
  getDiscordProviderAccountIdForHqUser,
  syncDiscordHqLinkFromOAuthSignIn,
} from "@/lib/auth/discord-hq-link.server";
import { hqUserHasActiveAllianceMembership } from "@/lib/native-alliance/access";
import { resolveDiscordMemberLinkPagePath } from "@/lib/navigation/safe-redirect.shared";
import { getValidDiscordAuthNonce } from "@/lib/vr/auth-nonce";

export type DiscordMemberLinkGateState =
  | { kind: "invalid_nonce" }
  | { kind: "needs_auth"; returnPath: string }
  | { kind: "needs_discord_oauth"; nonce: string; returnPath: string }
  | { kind: "discord_mismatch" }
  | { kind: "needs_join_code"; nonce: string; returnPath: string }
  | { kind: "ready"; nonce: string; discordUserId: string };

export type DiscordMemberLinkWebSessionDenyReason =
  | "invalid_nonce"
  | "not_signed_in"
  | "discord_mismatch"
  | "needs_join_code";

export async function resolveDiscordMemberLinkGate(input: {
  nonce: string;
  hqUserId: string | null;
}): Promise<DiscordMemberLinkGateState> {
  const nonce = input.nonce.trim();
  const nonceRow = await getValidDiscordAuthNonce(nonce);
  if (!nonceRow || nonceRow.purpose !== "member_link") {
    return { kind: "invalid_nonce" };
  }

  const returnPath = resolveDiscordMemberLinkPagePath(nonce);
  const expectedDiscordUserId = nonceRow.discordUserId.trim();

  if (!input.hqUserId?.trim()) {
    return { kind: "needs_auth", returnPath };
  }

  const hqUserId = input.hqUserId.trim();
  const discordAccountId = await getDiscordProviderAccountIdForHqUser(hqUserId);

  if (!discordAccountId) {
    return { kind: "needs_discord_oauth", nonce, returnPath };
  }

  if (discordAccountId !== expectedDiscordUserId) {
    return { kind: "discord_mismatch" };
  }

  await syncDiscordHqLinkFromOAuthSignIn({
    discordUserId: expectedDiscordUserId,
    hqUserId,
  });

  const hasMembership = await hqUserHasActiveAllianceMembership(hqUserId);
  if (!hasMembership) {
    return { kind: "needs_join_code", nonce, returnPath };
  }

  return { kind: "ready", nonce, discordUserId: expectedDiscordUserId };
}

export async function assertDiscordMemberLinkWebSession(input: {
  nonce: string;
  hqUserId: string | null;
}): Promise<
  | { ok: true; discordUserId: string }
  | { ok: false; reason: DiscordMemberLinkWebSessionDenyReason }
> {
  const gate = await resolveDiscordMemberLinkGate(input);
  switch (gate.kind) {
    case "ready":
      return { ok: true, discordUserId: gate.discordUserId };
    case "needs_auth":
      return { ok: false, reason: "not_signed_in" };
    case "needs_discord_oauth":
    case "discord_mismatch":
      return { ok: false, reason: "discord_mismatch" };
    case "needs_join_code":
      return { ok: false, reason: "needs_join_code" };
    case "invalid_nonce":
      return { ok: false, reason: "invalid_nonce" };
  }
}
