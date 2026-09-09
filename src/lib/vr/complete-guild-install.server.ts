import "server-only";

import {
  bindGuildAllianceForRegistration,
  callerCanRegisterGuildAlliance,
  getAllianceById,
  saveDiscordBotPending,
} from "@/lib/vr/repository";

export type CompleteGuildInstallResult =
  | { ok: true; tag: string; allianceId: string }
  | {
      ok: false;
      reason:
        | "missing_alliance"
        | "not_owner"
        | "no_credentials"
        | "no_hq_link"
        | "guild_bound_to_other_alliance";
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

  const bind = await bindGuildAllianceForRegistration({
    guildId,
    allianceId,
    discordUserId,
  });
  if (!bind.ok) {
    return { ok: false, reason: bind.reason };
  }

  await saveDiscordBotPending(allianceId, discordUserId, null);

  const alliance = await getAllianceById(allianceId);
  return {
    ok: true,
    tag: alliance?.tag ?? "",
    allianceId,
  };
}
