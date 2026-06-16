import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import { base44ListMembers } from "@/lib/base44/fetch";
import { decryptSecret } from "@/lib/crypto/encrypt";
import type { AshedMember } from "@/lib/video/member-matcher";

import {
  getAllianceAshedCredential,
  getAllianceById,
} from "@/lib/vr/repository";

export function buildLegacyBotAshedConnection(): ParsedConnection | null {
  const token = process.env.VR_BOT_ASHED_BEARER_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    appId: process.env.BASE44_APP_ID?.trim() || DEFAULT_APP_ID,
    originUrl: process.env.BASE44_ORIGIN_URL?.trim() || "https://ashed.online",
  };
}

function legacyTokenAllowedForAlliance(allianceTag: string): boolean {
  const guardTag = process.env.VR_BOT_ASHED_ALLIANCE_TAG?.trim();
  if (!guardTag) return false;
  return allianceTag.trim().toLowerCase() === guardTag.trim().toLowerCase();
}

async function resolveBotAshedConnection(
  allianceId: string,
): Promise<ParsedConnection | null> {
  const credential = await getAllianceAshedCredential(allianceId);
  if (credential) {
    try {
      return {
        token: decryptSecret(credential.encryptedToken),
        appId: credential.appId,
        originUrl: credential.originUrl,
      };
    } catch (error) {
      console.error("[discord-bot] failed to decrypt alliance credential", error);
      return null;
    }
  }

  const alliance = await getAllianceById(allianceId);
  if (!alliance?.tag) return null;
  if (!legacyTokenAllowedForAlliance(alliance.tag)) return null;

  return buildLegacyBotAshedConnection();
}

export async function loadAllianceMembersForBot(
  allianceId: string,
): Promise<AshedMember[]> {
  const alliance = await getAllianceById(allianceId);
  if (!alliance?.ashedAllianceId) return [];

  const connection = await resolveBotAshedConnection(allianceId);
  if (!connection) return [];

  return base44ListMembers(connection, alliance.ashedAllianceId);
}

/** @deprecated Use loadAllianceMembersForBot — kept for tests importing buildBotAshedConnection */
export const buildBotAshedConnection = buildLegacyBotAshedConnection;
