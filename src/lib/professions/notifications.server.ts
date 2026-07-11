import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getProfessionChannelsForAlliance } from "./repository";

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
};

async function resolveTargetForCommander(
  commanderId: string,
): Promise<NotificationTarget> {
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

  if (!link) return { email: null, discordUserId: null };

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

  return {
    email: user?.email ?? null,
    discordUserId: discordLink?.discordUserId ?? null,
  };
}

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
      resolveTargetForCommander(payload.engCommanderId),
      resolveTargetForCommander(payload.wlCommanderId),
    ]);

    const engMsg = `You've been assigned to a War Leader's support team! Visit ${appUrl}/professions to set your coverage window.`;
    const wlMsg = `A new Engineer has joined your support team. Visit ${appUrl}/professions to view your team.`;

    await Promise.all([
      engTarget.email &&
        sendProfessionEmail({
          to: engTarget.email,
          subject: "You've been assigned to a War Leader team",
          text: engMsg,
        }),
      engTarget.discordUserId && sendDiscordDm(engTarget.discordUserId, engMsg),
      wlTarget.email &&
        sendProfessionEmail({
          to: wlTarget.email,
          subject: "A new Engineer joined your team",
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
    const engTarget = await resolveTargetForCommander(payload.engCommanderId);
    const reasonNote = payload.reason ? ` Reason: ${payload.reason}` : "";
    const msg = `You have been removed from a War Leader's support team.${reasonNote} Visit ${appUrl}/professions to find a new War Leader.`;

    await Promise.all([
      engTarget.email &&
        sendProfessionEmail({
          to: engTarget.email,
          subject: "You've been removed from a War Leader team",
          text: msg,
        }),
      engTarget.discordUserId && sendDiscordDm(engTarget.discordUserId, msg),
    ]);
    return;
  }

  if (payload.kind === "eng_self_removed") {
    const wlTarget = await resolveTargetForCommander(payload.wlCommanderId);
    const msg = `An Engineer has left your support team. Visit ${appUrl}/professions to see your current team.`;
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
    const target = await resolveTargetForCommander(payload.commanderId);
    const msg = `Your profession has been updated: ${payload.from} → ${payload.to}. Visit ${appUrl}/professions to get started.`;

    await Promise.all([
      target.email &&
        sendProfessionEmail({
          to: target.email,
          subject: "Your profession has been updated",
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
