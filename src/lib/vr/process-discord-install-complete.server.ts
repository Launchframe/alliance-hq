import "server-only";

import {
  consumeDiscordBotInstallSession,
  getValidDiscordBotInstallSession,
} from "@/lib/vr/bot-install-session.server";
import { completeGuildRegistrationForInstall } from "@/lib/vr/complete-guild-install.server";

export type ProcessDiscordInstallCompleteResult =
  | { ok: true; tag: string; allianceId: string }
  | {
      ok: false;
      reason:
        | "missing_params"
        | "expired_session"
        | "session_user_mismatch"
        | "missing_alliance"
        | "not_owner"
        | "no_credentials"
        | "no_hq_link";
    };

export async function processDiscordInstallComplete(input: {
  guildId: string;
  stateNonce: string;
  hqUserId: string;
}): Promise<ProcessDiscordInstallCompleteResult> {
  const guildId = input.guildId.trim();
  const stateNonce = input.stateNonce.trim();
  const hqUserId = input.hqUserId.trim();

  if (!guildId || !stateNonce || !hqUserId) {
    return { ok: false, reason: "missing_params" };
  }

  const session = await getValidDiscordBotInstallSession(stateNonce);
  if (!session) {
    return { ok: false, reason: "expired_session" };
  }

  if (session.hqUserId !== hqUserId) {
    return { ok: false, reason: "session_user_mismatch" };
  }

  const allianceId = session.allianceId?.trim();
  if (!allianceId) {
    return { ok: false, reason: "missing_alliance" };
  }

  const registration = await completeGuildRegistrationForInstall({
    guildId,
    discordUserId: session.discordUserId,
    allianceId,
  });

  if (!registration.ok) {
    return { ok: false, reason: registration.reason };
  }

  await consumeDiscordBotInstallSession(session.id);

  return {
    ok: true,
    tag: registration.tag,
    allianceId: registration.allianceId,
  };
}
