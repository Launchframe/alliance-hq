import { eq } from "drizzle-orm";

import { redirect } from "next/navigation";

import { getDb, schema } from "@/lib/db";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { loadSession, requirePageSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";

export type PromptStudioPagePayload = {
  alliance: {
    id: string;
    tag: string;
    name: string;
  };
  seasonKey: string | null;
  roster: Array<{ memberId: string; memberName: string }>;
  canManageTrains: boolean;
};

export async function loadPromptStudioPage(
  sessionId: string,
): Promise<PromptStudioPagePayload | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) return null;

  const db = getDb();
  const [allianceRow] = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!allianceRow?.tag) return null;

  const [canManageTrains, effectiveSeason, members] = await Promise.all([
    sessionHasPermission(sessionId, "trains:write"),
    getEffectiveSeasonForAlliance(allianceId),
    loadActiveAlliancePoolMembers({ allianceId }),
  ]);

  return {
    alliance: {
      id: allianceRow.id,
      tag: allianceRow.tag,
      name: allianceRow.name ?? allianceRow.tag,
    },
    seasonKey: effectiveSeason.seasonKey,
    roster: members.map((member) => ({
      memberId: member.ashedMemberId,
      memberName: member.currentName,
    })),
    canManageTrains,
  };
}

export async function requirePromptStudioPage() {
  const session = await requirePageSession("/trains/prompts/new");
  const payload = await loadPromptStudioPage(session.id);
  if (!payload) {
    redirect("/trains");
  }
  if (!payload.canManageTrains) {
    redirect("/trains");
  }
  return payload;
}
