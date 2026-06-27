import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import { base44ListMembers } from "@/lib/base44/fetch";
import { decryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { and, eq, ne } from "drizzle-orm";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import type { AshedMember } from "@/lib/video/member-matcher";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";

import { syncAllianceMembersFromAshed } from "@/lib/members/roster.server";
import { findExactMemberByName } from "@/lib/vr/link-helpers";
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

export type MemberLinkRosterSource =
  | "native_local"
  | "local_synced"
  | "ashed_live"
  | "empty"
  | "not_loaded";

async function loadLocalAllianceMembers(
  allianceId: string,
): Promise<AshedMember[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    );
  return rows.map(allianceMemberRowToAshedMember);
}

export async function loadAllianceMembersForMemberLink(
  allianceId: string,
): Promise<{ members: AshedMember[]; rosterSource: MemberLinkRosterSource }> {
  if (await isNativeAlliance(allianceId)) {
    const members = await loadLocalAllianceMembers(allianceId);
    return {
      members,
      rosterSource: members.length > 0 ? "native_local" : "empty",
    };
  }

  const local = await loadLocalAllianceMembers(allianceId);
  if (local.length > 0) {
    return { members: local, rosterSource: "local_synced" };
  }

  const alliance = await getAllianceById(allianceId);
  if (!alliance?.ashedAllianceId) {
    return { members: [], rosterSource: "empty" };
  }

  const connection = await resolveBotAshedConnection(allianceId);
  if (!connection) {
    return { members: [], rosterSource: "empty" };
  }

  const members = await base44ListMembers(connection, alliance.ashedAllianceId);
  return {
    members,
    rosterSource: members.length > 0 ? "ashed_live" : "empty",
  };
}

export async function loadAllianceMembersForMemberLinkWithLiveRetry(
  allianceId: string,
  gameUserName: string,
): Promise<{ members: AshedMember[]; rosterSource: MemberLinkRosterSource }> {
  const initial = await loadAllianceMembersForMemberLink(allianceId);
  if (
    findExactMemberByName(initial.members, gameUserName) ||
    initial.rosterSource !== "local_synced"
  ) {
    return initial;
  }

  const alliance = await getAllianceById(allianceId);
  if (!alliance?.ashedAllianceId) {
    return initial;
  }

  const connection = await resolveBotAshedConnection(allianceId);
  if (!connection) {
    return initial;
  }

  try {
    await syncAllianceMembersFromAshed({
      hqAllianceId: allianceId,
      ashedAllianceId: alliance.ashedAllianceId,
      connection,
    });
  } catch (error) {
    console.error("[member-roster] live refresh on miss failed", error);
    return initial;
  }

  const members = await loadLocalAllianceMembers(allianceId);
  return {
    members,
    rosterSource: members.length > 0 ? "ashed_live" : "empty",
  };
}

export async function loadAllianceMembersForBot(
  allianceId: string,
): Promise<AshedMember[]> {
  const { members } = await loadAllianceMembersForMemberLink(allianceId);
  return members;
}

export async function allianceHasBotCredentials(allianceId: string): Promise<boolean> {
  if (await isNativeAlliance(allianceId)) {
    return true;
  }

  const alliance = await getAllianceById(allianceId);
  if (!alliance?.ashedAllianceId) return false;
  return (await resolveBotAshedConnection(allianceId)) != null;
}

/** @deprecated Use loadAllianceMembersForBot — kept for tests importing buildBotAshedConnection */
export const buildBotAshedConnection = buildLegacyBotAshedConnection;
