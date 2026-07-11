import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { extractHqInviteToken } from "@/lib/native-alliance/invite-token-from-input.shared";
import { buildInviteShareMessage } from "@/lib/native-alliance/invite-share-message.server";
import type { InviteShareVariant } from "@/lib/native-alliance/invite-share-message.server";
import {
  buildWelcomeInviteUrl,
  buildWelcomeJoinCodeUrl,
} from "@/lib/native-alliance/welcome-url.shared";

export type InviteSharePayload = {
  welcomeUrl: string | null;
  shareMessage: string;
  welcomeUrlRequiresAllianceTag: boolean;
};

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

export function buildJoinCodeSharePayload(input: {
  origin: string;
  allianceName: string;
  allianceTag: string | null;
  code: string;
  variant: Extract<InviteShareVariant, "join_code" | "claim_code">;
}): InviteSharePayload {
  const welcomeUrl = buildWelcomeJoinCodeUrl(
    input.origin,
    input.allianceTag,
    input.code,
  );
  const welcomeUrlRequiresAllianceTag = welcomeUrl === null;
  return {
    welcomeUrl,
    welcomeUrlRequiresAllianceTag,
    shareMessage: buildInviteShareMessage({
      variant: input.variant,
      allianceName: input.allianceName,
      welcomeUrl,
      joinCode: input.code,
    }),
  };
}

export function buildInviteLinkSharePayload(input: {
  origin: string;
  allianceName: string;
  inviteUrl: string;
  passphrase?: string | null;
}): InviteSharePayload {
  const token = extractHqInviteToken(input.inviteUrl);
  const welcomeUrl = token
    ? buildWelcomeInviteUrl(input.origin, token)
    : input.inviteUrl;
  return {
    welcomeUrl,
    welcomeUrlRequiresAllianceTag: false,
    shareMessage: buildInviteShareMessage({
      variant: "invite_link",
      allianceName: input.allianceName,
      welcomeUrl,
      passphrase: input.passphrase,
    }),
  };
}
