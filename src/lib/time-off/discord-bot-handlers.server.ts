import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { parseTimeOffMessage } from "@/lib/time-off/parse-natural-language.shared";
import {
  createTimeOffEntry,
  findActiveTimeOffForMemberOnDate,
  listTimeOffForMember,
} from "@/lib/time-off/repository.server";
import type { SerializedTimeOffEntry } from "@/lib/time-off/types.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { listDiscordLinksForStatusQuery } from "@/lib/vr/bot-member-links.server";
import { findExactMemberByName } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import { writeDiscordBotAudit } from "@/lib/vr/repository";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";
import { getAllianceById } from "@/lib/vr/repository";

export type TimeOffBotReply = {
  reply: string;
  pickCandidates?: Array<{ memberId: string; name: string }>;
};

function formatAvailability(
  t: ReturnType<typeof createDiscordTranslator>,
  availability: string,
): string {
  switch (availability) {
    case "limited":
      return t("timeOff.availabilityLimited");
    case "minimums":
      return t("timeOff.availabilityMinimums");
    case "hit_and_miss":
      return t("timeOff.availabilityHitAndMiss");
    default:
      return t("timeOff.availabilityFullAway");
  }
}

function formatEntrySummary(
  t: ReturnType<typeof createDiscordTranslator>,
  entry: SerializedTimeOffEntry,
): string {
  const availability = formatAvailability(t, entry.availability);
  const notes = entry.notes?.trim()
    ? t("timeOff.notesLine", { notes: entry.notes.trim() })
    : "";
  return t("timeOff.entrySummary", {
    name: entry.memberName,
    start: entry.startDate,
    end: entry.endDate,
    availability,
    notes,
  });
}

export async function handleDiscordMyTimeOff(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  message?: string;
  start?: string;
  end?: string;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const links = await listDiscordLinksForStatusQuery(
    input.allianceId,
    input.discordUserId,
  );
  if (links.length === 0) {
    const reply = t("timeOff.notLinked");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "my_time_off",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  if (links.length > 1 && !input.message?.trim() && !input.start) {
    const names = links.map((link) => link.memberDisplayName).join(", ");
    const reply = t("timeOff.multipleCommanders", { names });
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "my_time_off",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const link = links[0]!;
  const today = getServerCalendarDate();

  if (!input.message?.trim() && !input.start) {
    const upcoming = await listTimeOffForMember({
      allianceId: input.allianceId,
      ashedMemberId: link.ashedMemberId,
      onOrAfter: today,
    });
    if (upcoming.length === 0) {
      const reply = t("timeOff.noUpcoming", { name: link.memberDisplayName ?? "" });
      await writeDiscordBotAudit({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
        command: "my_time_off",
        payload: input,
        result: { reply },
      });
      return { reply };
    }
    const lines = upcoming.map((entry) => formatEntrySummary(t, entry));
    const reply = t("timeOff.upcomingList", {
      name: link.memberDisplayName ?? "",
      entries: lines.join("\n"),
    });
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "my_time_off",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  let startDate = input.start?.trim();
  let endDate = input.end?.trim();
  let notes: string | null = null;
  let availability: "full_away" | "limited" | "minimums" | "hit_and_miss" =
    "full_away";

  if (input.message?.trim()) {
    const parsed = parseTimeOffMessage(input.message.trim(), today);
    if (!parsed.ok) {
      const reply = t("timeOff.parseFailed");
      await writeDiscordBotAudit({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
        command: "my_time_off",
        payload: input,
        result: { reply },
      });
      return { reply };
    }
    startDate = parsed.parsed.startDate;
    endDate = parsed.parsed.endDate;
    notes = parsed.parsed.notes;
    availability = parsed.parsed.availability;
  }

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const reply = t("timeOff.invalidStart");
    return { reply };
  }
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    endDate = startDate;
  }
  if (endDate < startDate) {
    const reply = t("timeOff.invalidRange");
    return { reply };
  }

  const row = await createTimeOffEntry({
    allianceId: input.allianceId,
    payload: {
      ashedMemberId: link.ashedMemberId,
      memberName: link.memberDisplayName ?? "Commander",
      startDate,
      endDate,
      notes,
      availability,
      entryKind: "planned",
      source: "discord",
    },
    createdByDiscordUserId: input.discordUserId,
  });

  const reply = t("timeOff.saved", {
    summary: formatEntrySummary(t, {
      id: row.id,
      ashedMemberId: row.ashedMemberId,
      memberName: row.memberName,
      startDate: row.startDate,
      endDate: row.endDate,
      notes: row.notes,
      availability: row.availability as SerializedTimeOffEntry["availability"],
      entryKind: "planned",
      source: "discord",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "my_time_off",
    payload: input,
    result: { reply, entryId: row.id },
  });

  return { reply };
}

export async function handleDiscordIsAllyOffline(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  commander?: string;
  date?: string;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const name = input.commander?.trim();
  if (!name) {
    const reply = t("timeOff.usageIsOffline");
    return { reply };
  }

  const [members, alliance] = await Promise.all([
    loadAllianceMembersForBot(input.allianceId),
    getAllianceById(input.allianceId),
  ]);

  const exact = findExactMemberByName(members, name);
  let memberId: string | null = exact?.id ?? null;
  let memberName: string | null = exact?.current_name ?? null;

  if (!exact) {
    const candidates = findFuzzyMemberCandidates(name, members, {
      allianceTag: alliance?.tag,
      limit: 5,
    });
    if (candidates.length === 0) {
      const reply = t("timeOff.commanderNotFound", { name });
      await writeDiscordBotAudit({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
        command: "is_ally_offline",
        payload: input,
        result: { reply },
      });
      return { reply };
    }
    if (candidates.length > 1) {
      const reply = t("timeOff.pickCommander", {
        names: candidates.map((c) => c.name).join(", "),
      });
      return {
        reply,
        pickCandidates: candidates.map((c) => ({
          memberId: c.memberId,
          name: c.name,
        })),
      };
    }
    memberId = candidates[0]!.memberId;
    memberName = candidates[0]!.name;
  }

  const resolvedMemberId = memberId!;
  const resolvedMemberName = memberName!;
  const date =
    input.date?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())
      ? input.date.trim()
      : getServerCalendarDate();

  const active = await findActiveTimeOffForMemberOnDate({
    allianceId: input.allianceId,
    ashedMemberId: resolvedMemberId,
    date,
  });

  const reply = active
    ? t("timeOff.isAway", {
        name: resolvedMemberName,
        date,
        summary: formatEntrySummary(t, active),
      })
    : t("timeOff.isAvailable", { name: resolvedMemberName, date });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "is_ally_offline",
    payload: input,
    result: { reply, ashedMemberId: resolvedMemberId },
  });

  return { reply };
}
