import "server-only";

import {
  callerCanRegisterGuildAlliance,
  getAllianceById,
  saveDiscordBotPending,
  upsertGuildAlliance,
} from "@/lib/vr/repository";

export type CompleteGuildInstallResult =
  | { ok: true; tag: string; allianceId: string }
  | {
      ok: false;
      reason: "missing_alliance" | "not_owner" | "no_credentials" | "no_hq_link";
    };

export async function completeGuildRegistrationForInstall(input: {
  guildId: string;
  discordUserId: string;
  allianceId: string;
}): Promise<CompleteGuildInstallResult> {
  const guildId = input.guildId.trim();
  const discordUserId = input.discordUserId.trim();
  const allianceId = input.allianceId.trim();

  if (!guildId || !discordUserId || !allianceId) {
    return { ok: false, reason: "missing_alliance" };
  }

  const registration = await callerCanRegisterGuildAlliance({
    allianceId,
    discordUserId,
  });

  if (!registration.allowed) {
    return { ok: false, reason: registration.reason };
  }

  await upsertGuildAlliance(guildId, allianceId);
  await saveDiscordBotPending(allianceId, discordUserId, null);

  const alliance = await getAllianceById(allianceId);
  return {
    ok: true,
    tag: alliance?.tag ?? "",
    allianceId,
  };
}
