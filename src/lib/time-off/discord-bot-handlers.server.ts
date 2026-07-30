import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { parseTimeOffMessage } from "@/lib/time-off/parse-natural-language.shared";
import {
  matchLinkedCommanderByName,
  parseWhoIsAwayWhen,
  resolveWhoIsAwayRange,
} from "@/lib/time-off/discord-officer-helpers.shared";
import {
  cancelTimeOffEntry,
  createTimeOffEntry,
  findActiveTimeOffForMemberOnDate,
  findLatestUpcomingTimeOffForMember,
  findTimeOffEntryById,
  findTimeOffEntryByMemberAndStart,
  listActiveTimeOffEntries,
  listTimeOffForMember,
  listUnexpectedAbsenceReport,
} from "@/lib/time-off/repository.server";
import type { SerializedTimeOffEntry } from "@/lib/time-off/types.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import { listDiscordLinksForStatusQuery } from "@/lib/vr/bot-member-links.server";
import { findExactMemberByName } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import { writeDiscordBotAudit } from "@/lib/vr/repository";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";
import { getAllianceById } from "@/lib/vr/repository";

export type TimeOffBotReply = {
  reply: string;
  pickCandidates?: Array<{ memberId: string; name: string; date?: string }>;
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
    id: entry.id,
    name: entry.memberName,
    start: entry.startDate,
    end: entry.endDate,
    availability,
    notes,
  });
}

/** Roster-based commander lookup shared by the officer commands below. */
async function resolveOfficerCommanderTarget(input: {
  allianceId: string;
  locale: DiscordBotLocale;
  name: string;
}): Promise<
  | { ok: true; memberId: string; memberName: string }
  | { ok: false; reply: string }
> {
  const t = createDiscordTranslator(input.locale);
  const [members, alliance] = await Promise.all([
    loadAllianceMembersForBot(input.allianceId),
    getAllianceById(input.allianceId),
  ]);

  const exact = findExactMemberByName(members, input.name);
  if (exact) {
    return { ok: true, memberId: exact.id, memberName: exact.current_name };
  }

  const candidates = findFuzzyMemberCandidates(input.name, members, {
    allianceTag: alliance?.tag,
    limit: 5,
  });
  if (candidates.length === 0) {
    return { ok: false, reply: t("timeOff.commanderNotFound", { name: input.name }) };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reply: t("timeOff.pickCommander", {
        names: candidates.map((c) => c.name).join(", "),
      }),
    };
  }
  return { ok: true, memberId: candidates[0]!.memberId, memberName: candidates[0]!.name };
}

export async function handleDiscordMyTimeOff(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  message?: string;
  start?: string;
  end?: string;
  cancel?: string;
  commander?: string;
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

  let link = links[0]!;
  if (links.length > 1) {
    const picked = matchLinkedCommanderByName(links, input.commander);
    if (!picked) {
      const names = links.map((l) => l.memberDisplayName ?? l.ashedMemberId);
      const reply = [
        t("timeOff.pickYourCommander"),
        names.map((name) => `• ${name}`).join("\n"),
        t("timeOff.multipleCommanders", { names: names.join(", ") }),
      ].join("\n");
      await writeDiscordBotAudit({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
        command: "my_time_off",
        payload: input,
        result: { reply },
      });
      return { reply };
    }
    link = picked;
  }

  const today = getServerCalendarDate();

  const cancelTarget = input.cancel?.trim();
  if (cancelTarget) {
    const entry =
      cancelTarget.toLowerCase() === "latest"
        ? await findLatestUpcomingTimeOffForMember({
            allianceId: input.allianceId,
            ashedMemberId: link.ashedMemberId,
            onOrAfter: today,
          })
        : await findTimeOffEntryById({
            allianceId: input.allianceId,
            entryId: cancelTarget,
          });

    // Ownership check: id-lookup must not let a member cancel someone else's entry.
    const owned = entry && entry.ashedMemberId === link.ashedMemberId ? entry : null;
    if (!owned) {
      const reply = `${t("timeOff.cancelNotFound")}\n${t("timeOff.cancelUsage")}`;
      await writeDiscordBotAudit({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
        command: "my_time_off_cancel",
        payload: input,
        result: { reply },
      });
      return { reply };
    }

    const cancelled = await cancelTimeOffEntry({
      allianceId: input.allianceId,
      entryId: owned.id,
    });
    if (!cancelled) {
      const reply = t("timeOff.cancelNotFound");
      return { reply };
    }

    const reply = t("timeOff.cancelled", {
      name: owned.memberName,
      start: owned.startDate,
      end: owned.endDate,
    });
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "my_time_off_cancel",
      payload: input,
      result: { reply, entryId: owned.id },
    });
    return { reply };
  }

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

  const date =
    input.date?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())
      ? input.date.trim()
      : getServerCalendarDate();

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
          date,
        })),
      };
    }
    memberId = candidates[0]!.memberId;
    memberName = candidates[0]!.name;
  }

  const resolvedMemberId = memberId!;
  const resolvedMemberName = memberName!;

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

/** Re-runs the offline check after the caller taps a fuzzy-match pick button. */
export async function handleDiscordIsAllyOfflinePick(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  memberId: string;
  date: string;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const members = await loadAllianceMembersForBot(input.allianceId);
  const member = members.find((m) => m.id === input.memberId);
  if (!member) {
    const reply = t("timeOff.pickExpired");
    return { reply };
  }

  const active = await findActiveTimeOffForMemberOnDate({
    allianceId: input.allianceId,
    ashedMemberId: member.id,
    date: input.date,
  });

  const reply = active
    ? t("timeOff.isAway", {
        name: member.current_name,
        date: input.date,
        summary: formatEntrySummary(t, active),
      })
    : t("timeOff.isAvailable", { name: member.current_name, date: input.date });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "is_ally_offline_pick",
    payload: input,
    result: { reply, ashedMemberId: member.id },
  });

  return { reply };
}

export async function handleDiscordSetTimeOff(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  member?: string;
  start?: string;
  end?: string;
  kind?: string;
  notes?: string;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanRunVrReport({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    const reply = t("timeOff.officerDenied");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "set_time_off",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const name = input.member?.trim();
  const startDate = input.start?.trim();
  if (!name || !startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const reply = t("timeOff.invalidDate");
    return { reply };
  }
  let endDate = input.end?.trim();
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    endDate = startDate;
  }
  if (endDate < startDate) {
    const reply = t("timeOff.invalidRange");
    return { reply };
  }

  const target = await resolveOfficerCommanderTarget({
    allianceId: input.allianceId,
    locale: input.locale,
    name,
  });
  if (!target.ok) {
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "set_time_off",
      payload: input,
      result: { reply: target.reply },
    });
    return { reply: target.reply };
  }

  const entryKind = input.kind === "unexpected" ? "unexpected" : "officer_marked";
  const row = await createTimeOffEntry({
    allianceId: input.allianceId,
    payload: {
      ashedMemberId: target.memberId,
      memberName: target.memberName,
      startDate,
      endDate,
      notes: input.notes ?? null,
      availability: "full_away",
      entryKind,
      source: "officer",
    },
    createdByDiscordUserId: input.discordUserId,
  });

  const reply = t("timeOff.markSaved", {
    summary: formatEntrySummary(t, {
      id: row.id,
      ashedMemberId: row.ashedMemberId,
      memberName: row.memberName,
      startDate: row.startDate,
      endDate: row.endDate,
      notes: row.notes,
      availability: row.availability as SerializedTimeOffEntry["availability"],
      entryKind: row.entryKind as SerializedTimeOffEntry["entryKind"],
      source: "officer",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "set_time_off",
    payload: input,
    result: { reply, entryId: row.id },
  });

  return { reply };
}

export async function handleDiscordCancelTimeOffOfficer(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  entryId?: string;
  commander?: string;
  start?: string;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanRunVrReport({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    const reply = t("timeOff.officerDenied");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "cancel_time_off",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  let entry: SerializedTimeOffEntry | null = null;
  const entryId = input.entryId?.trim();
  if (entryId) {
    entry = await findTimeOffEntryById({ allianceId: input.allianceId, entryId });
  } else {
    const name = input.commander?.trim();
    const startDate = input.start?.trim();
    if (!name || !startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      const reply = t("timeOff.cancelUsageOfficer");
      return { reply };
    }
    const target = await resolveOfficerCommanderTarget({
      allianceId: input.allianceId,
      locale: input.locale,
      name,
    });
    if (!target.ok) {
      return { reply: target.reply };
    }
    entry = await findTimeOffEntryByMemberAndStart({
      allianceId: input.allianceId,
      ashedMemberId: target.memberId,
      startDate,
    });
  }

  if (!entry) {
    const reply = t("timeOff.cancelNotFound");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "cancel_time_off",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const cancelled = await cancelTimeOffEntry({
    allianceId: input.allianceId,
    entryId: entry.id,
  });
  if (!cancelled) {
    const reply = t("timeOff.cancelNotFound");
    return { reply };
  }

  const reply = t("timeOff.cancelled", {
    name: entry.memberName,
    start: entry.startDate,
    end: entry.endDate,
  });
  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "cancel_time_off",
    payload: input,
    result: { reply, entryId: entry.id },
  });

  return { reply };
}

export async function handleDiscordWhoIsAway(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  when?: string;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanRunVrReport({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    const reply = t("timeOff.officerDenied");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "who_is_away",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const when = parseWhoIsAwayWhen(input.when);
  const today = getServerCalendarDate();
  const { rangeStart, rangeEnd } = resolveWhoIsAwayRange(today, when);
  const whenLabel =
    when === "week" ? t("timeOff.whenThisWeek") : t("timeOff.whenToday");

  const entries = await listActiveTimeOffEntries({
    allianceId: input.allianceId,
    rangeStart,
    rangeEnd,
  });

  const reply =
    entries.length === 0
      ? t("timeOff.whoIsAwayEmpty", { when: whenLabel })
      : t("timeOff.whoIsAwayHeader", {
          when: whenLabel,
          entries: entries.map((entry) => formatEntrySummary(t, entry)).join("\n"),
        });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "who_is_away",
    payload: input,
    result: { reply },
  });

  return { reply };
}

export async function handleDiscordUnexpectedAbsences(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<TimeOffBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanRunVrReport({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    const reply = t("timeOff.officerDenied");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "unexpected_absences",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const today = getServerCalendarDate();
  const unexpected = await listUnexpectedAbsenceReport({
    allianceId: input.allianceId,
    asOfDate: today,
  });

  const reply =
    unexpected.length === 0
      ? t("timeOff.unexpectedEmpty")
      : t("timeOff.unexpectedHeader", {
          entries: unexpected.map((entry) => formatEntrySummary(t, entry)).join("\n"),
        });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "unexpected_absences",
    payload: input,
    result: { reply },
  });

  return { reply };
}
