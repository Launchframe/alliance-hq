import "server-only";

import { loadAllianceRow } from "@/lib/members/game-roster";
import { getRbacContext } from "@/lib/rbac/context";
import { getDiscordHqLink } from "@/lib/vr/repository";

export async function sessionCanUnlimitedUnlockConductor(
  sessionId: string,
  allianceId: string | null | undefined,
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  if (!ctx) return false;
  if (ctx.isPlatformMaintainer) return true;
  if (ctx.roleName === "owner") return true;
  if (!allianceId || !ctx.hqUserId) return false;
  const alliance = await loadAllianceRow(allianceId);
  return Boolean(
    alliance?.ownerHqUserId && alliance.ownerHqUserId === ctx.hqUserId,
  );
}

export async function resolveTrainActorHqUserId(
  sessionId: string,
): Promise<string | null> {
  const ctx = await getRbacContext(sessionId);
  return ctx?.hqUserId ?? null;
}

export async function resolveDiscordHqUserId(
  discordUserId: string,
): Promise<string | null> {
  const link = await getDiscordHqLink(discordUserId);
  return link?.hqUserId ?? null;
}
