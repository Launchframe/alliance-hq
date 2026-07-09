import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { extractHqInviteToken } from "@/lib/native-alliance/invite-token-from-input.shared";
import { buildInviteShareMessage } from "@/lib/native-alliance/invite-share-message.server";
import {
  buildWelcomeInviteUrl,
  buildWelcomeJoinCodeUrl,
} from "@/lib/native-alliance/welcome-url.shared";

export async function loadAllianceInviteShareContext(allianceId: string): Promise<{
  allianceName: string;
  allianceTag: string | null;
}> {
  const db = getDb();
  const [alliance] = await db
    .select({
      name: schema.alliances.name,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    allianceName: alliance?.name?.trim() || alliance?.tag?.trim() || "your alliance",
    allianceTag: alliance?.tag ?? null,
  };
}

export function buildClaimCodeSharePayload(input: {
  origin: string;
  allianceName: string;
  allianceTag: string | null;
  code: string;
}): { welcomeUrl: string; shareMessage: string } {
  const welcomeUrl = buildWelcomeJoinCodeUrl(
    input.origin,
    input.allianceTag,
    input.code,
  );
  return {
    welcomeUrl,
    shareMessage: buildInviteShareMessage({
      variant: "claim_code",
      allianceName: input.allianceName,
      welcomeUrl,
    }),
  };
}

export function buildMultiUseJoinCodeSharePayload(input: {
  origin: string;
  allianceName: string;
  allianceTag: string | null;
  code: string;
}): { welcomeUrl: string; shareMessage: string } {
  const welcomeUrl = buildWelcomeJoinCodeUrl(
    input.origin,
    input.allianceTag,
    input.code,
  );
  return {
    welcomeUrl,
    shareMessage: buildInviteShareMessage({
      variant: "join_code",
      allianceName: input.allianceName,
      welcomeUrl,
    }),
  };
}

export function buildInviteLinkSharePayload(input: {
  origin: string;
  allianceName: string;
  inviteUrl: string;
  passphrase?: string | null;
}): { welcomeUrl: string; shareMessage: string } {
  const token = extractHqInviteToken(input.inviteUrl);
  const welcomeUrl = token
    ? buildWelcomeInviteUrl(input.origin, token)
    : input.inviteUrl;
  return {
    welcomeUrl,
    shareMessage: buildInviteShareMessage({
      variant: "invite_link",
      allianceName: input.allianceName,
      welcomeUrl,
      passphrase: input.passphrase,
    }),
  };
}
