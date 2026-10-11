import "server-only";

import { and, eq } from "drizzle-orm";

import type { AppLocale } from "@/i18n/routing";
import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import {
  notificationTranslator,
  resolveDiscordRecipientLocale,
  resolveRecipientLocale,
} from "@/lib/notifications/locale.server";
import { getProfessionChannelsForAlliance, loadAwayProfessionCommanderIds } from "./repository";
import { getServerCalendarDate } from "@/lib/trains/game-time";

// ---------------------------------------------------------------------------
// Discord DM helper
// ---------------------------------------------------------------------------

/** Send a direct message to a Discord user. Best-effort — never throws. */
async function sendDiscordDm(
  discordUserId: string,
  content: string,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return;

  try {
    // Open DM channel
    const dmRes = await fetch(
      "https://discord.com/api/v10/users/@me/channels",
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recipient_id: discordUserId }),
      },
    );
    if (!dmRes.ok) return;
    const dmChannel = (await dmRes.json()) as { id: string };

    // Post message
    await fetch(
      `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Email helper
// ---------------------------------------------------------------------------

async function sendProfessionEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "Alliance HQ <noreply@frontline.gay>";
  if (!apiKey) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
    });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Resolve notification targets for a commander
// ---------------------------------------------------------------------------

type NotificationTarget = {
  email: string | null;
  discordUserId: string | null;
  locale: AppLocale;
};

const NO_TARGET: NotificationTarget = {
  email: null,
  discordUserId: null,
  locale: "en-US",
};

async function resolveTargetForCommander(
  commanderId: string,
  allianceId: string,
): Promise<NotificationTarget> {
  const awayCommanderIds = await loadAwayProfessionCommanderIds(allianceId, getServerCalendarDate());
  if (awayCommanderIds.has(commanderId)) return NO_TARGET;
  const db = getDb();
  // Commander → HQ user → email
  const [link] = await db
    .select({ hqUserId: schema.hqUserCommanders.hqUserId })
    .from(schema.hqUserCommanders)
    .where(
      and(
        eq(schema.hqUserCommanders.commanderId, commanderId),
        eq(schema.hqUserCommanders.isPrimary, true),
      ),
    )
    .limit(1);

  if (!link) return NO_TARGET;

  const [user] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, link.hqUserId))
    .limit(1);

  const [discordLink] = await db
    .select({ discordUserId: schema.discordHqLinks.discordUserId })
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.hqUserId, link.hqUserId))
    .limit(1);

  const discordUserId = discordLink?.discordUserId ?? null;
  return {
    email: user?.email ?? null,
    discordUserId,
    locale: discordUserId
      ? await resolveDiscordRecipientLocale(discordUserId)
      : await resolveRecipientLocale({ hqUserId: link.hqUserId }),
  };
}

function professionsTranslator(locale: AppLocale) {
  return notificationTranslator(locale, "notificationMessages.professions");
}

const PROFESSION_LABEL_KEYS: Record<string, string> = {
  Engineer: "engineer",
  "War Leader": "warLeader",
};

// ---------------------------------------------------------------------------
// Profession channel broadcast
// ---------------------------------------------------------------------------

async function broadcastToProfessionChannels(
  allianceId: string,
  message: string,
): Promise<void> {
  try {
    const channels = await getProfessionChannelsForAlliance(allianceId);
    await Promise.all(
      channels.map((ch) => postDiscordChannelMessage(ch.channelId, message)),
    );
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Main event notification dispatcher
// ---------------------------------------------------------------------------

export type ProfessionEventPayload =
  | {
      kind: "eng_assigned";
      allianceId: string;
      engCommanderId: string;
      wlCommanderId: string;
    }
  | {
      kind: "eng_dismissed";
      allianceId: string;
      engCommanderId: string;
      wlCommanderId: string;
      reason?: string;
    }
  | {
      kind: "eng_self_removed";
      allianceId: string;
      engCommanderId: string;
      wlCommanderId: string;
    }
  | {
      kind: "more_engs_requested";
      allianceId: string;
      wlCommanderId: string;
    }
  | {
      kind: "profession_switched";
      allianceId: string;
      commanderId: string;
      from: string;
      to: string;
    };

export async function notifyProfessionEvent(
  payload: ProfessionEventPayload,
): Promise<void> {
  try {
    await _notifyProfessionEvent(payload);
  } catch {
    // Never throw from notification logic
  }
}

async function _notifyProfessionEvent(
  payload: ProfessionEventPayload,
): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://frontline.gay";

  if (payload.kind === "eng_assigned") {
    const [engTarget, wlTarget] = await Promise.all([
      resolveTargetForCommander(payload.engCommanderId, payload.allianceId),
      resolveTargetForCommander(payload.wlCommanderId, payload.allianceId),
    ]);

    const url = `${appUrl}/professions`;
    const engT = professionsTranslator(engTarget.locale);
    const wlT = professionsTranslator(wlTarget.locale);
    const engMsg = engT("engAssigned.body", { url });
    const wlMsg = wlT("engJoined.body", { url });

    await Promise.all([
      engTarget.email &&
        sendProfessionEmail({
          to: engTarget.email,
          subject: engT("engAssigned.subject"),
          text: engMsg,
        }),
      engTarget.discordUserId && sendDiscordDm(engTarget.discordUserId, engMsg),
      wlTarget.email &&
        sendProfessionEmail({
          to: wlTarget.email,
          subject: wlT("engJoined.subject"),
          text: wlMsg,
        }),
      wlTarget.discordUserId && sendDiscordDm(wlTarget.discordUserId, wlMsg),
      broadcastToProfessionChannels(
        payload.allianceId,
        `An Engineer has been assigned to a War Leader team. Visit ${appUrl}/professions/officer for the full picture.`,
      ),
    ]);
    return;
  }

  if (payload.kind === "eng_dismissed") {
    const engTarget = await resolveTargetForCommander(payload.engCommanderId, payload.allianceId);
    const t = professionsTranslator(engTarget.locale);
    const url = `${appUrl}/professions`;
    const msg = payload.reason
      ? t("engDismissed.bodyWithReason", { reason: payload.reason, url })
      : t("engDismissed.body", { url });

    await Promise.all([
      engTarget.email &&
        sendProfessionEmail({
          to: engTarget.email,
          subject: t("engDismissed.subject"),
          text: msg,
        }),
      engTarget.discordUserId && sendDiscordDm(engTarget.discordUserId, msg),
    ]);
    return;
  }

  if (payload.kind === "eng_self_removed") {
    const wlTarget = await resolveTargetForCommander(payload.wlCommanderId, payload.allianceId);
    const msg = professionsTranslator(wlTarget.locale)("engLeft.body", {
      url: `${appUrl}/professions`,
    });
    await Promise.all([
      wlTarget.discordUserId && sendDiscordDm(wlTarget.discordUserId, msg),
    ]);
    return;
  }

  if (payload.kind === "more_engs_requested") {
    await broadcastToProfessionChannels(
      payload.allianceId,
      `A War Leader is requesting more Engineer support. Officers: visit ${appUrl}/professions/officer to review assignments.`,
    );
    return;
  }

  if (payload.kind === "profession_switched") {
    const target = await resolveTargetForCommander(payload.commanderId, payload.allianceId);
    const t = professionsTranslator(target.locale);
    const label = (profession: string) => {
      const key = PROFESSION_LABEL_KEYS[profession];
      return key ? t(`profession.${key}`) : profession;
    };
    const msg = t("professionSwitched.body", {
      from: label(payload.from),
      to: label(payload.to),
      url: `${appUrl}/professions`,
    });

    await Promise.all([
      target.email &&
        sendProfessionEmail({
          to: target.email,
          subject: t("professionSwitched.subject"),
          text: msg,
        }),
      target.discordUserId && sendDiscordDm(target.discordUserId, msg),
      broadcastToProfessionChannels(
        payload.allianceId,
        `A member switched profession: ${payload.from} → ${payload.to}. Visit ${appUrl}/professions/officer for details.`,
      ),
    ]);
    return;
  }
}
