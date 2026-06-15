import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import { base44ListMembers } from "@/lib/base44/fetch";
import type { AshedMember } from "@/lib/video/member-matcher";

import { getAllianceById } from "@/lib/vr/repository";

export function buildBotAshedConnection(): ParsedConnection | null {
  const token = process.env.VR_BOT_ASHED_BEARER_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    appId: process.env.BASE44_APP_ID?.trim() || DEFAULT_APP_ID,
    originUrl: process.env.BASE44_ORIGIN_URL?.trim() || "https://ashed.online",
  };
}

export async function loadAllianceMembersForBot(
  allianceId: string,
): Promise<AshedMember[]> {
  const alliance = await getAllianceById(allianceId);
  if (!alliance?.ashedAllianceId) return [];

  const connection = buildBotAshedConnection();
  if (!connection) return [];

  return base44ListMembers(connection, alliance.ashedAllianceId);
}
