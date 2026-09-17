import "server-only";

import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { createDiscordTranslator, getDiscordBotLocale, type DiscordBotLocale } from "@/lib/discord/i18n";
import { interactionDiscordUserId, interactionGuildId, type DiscordInteractionPayload } from "@/lib/discord/interactions";
import { callerCanManageTrains } from "@/lib/trains/discord-bot-auth.server";
import { draftConductorForAlliance, lockTrainAndAnnounce } from "@/lib/trains/discord-bot.server";
import { boardingDiscordPrompt } from "@/lib/trains/boarding.discord.server";
import type { TrainBotReply } from "@/lib/trains/discord-bot-handlers.server";
import { resolveDiscordHqUserId } from "@/lib/trains/train-ownership.server";
import { resolveAllianceForGuild } from "@/lib/vr/service";
import { CoverageConflictError, withCoverageActor } from "./coverage.server";
import { escapeTimeOffDiscordText } from "./discord-workflow.shared";

type State = NonNullable<TrainBotReply["coverage"]> & { kind: "train_coverage" };
type Actor = { allianceId: string; guildId: string; discordUserId: string; locale: DiscordBotLocale };

export async function showDiscordCoverage(actor: Actor, coverage: NonNullable<TrainBotReply["coverage"]>) {
  const t = createDiscordTranslator(actor.locale);
  if (!(await callerCanManageTrains(actor))) return { content: t("errors.notOfficer"), components: [] };
  const token = nanoid();
  await getDb().insert(schema.timeOffDiscordInteractions).values({ id: token, allianceId: actor.allianceId, guildId: actor.guildId, discordUserId: actor.discordUserId, state: { ...coverage, kind: "train_coverage" }, expiresAt: new Date(Date.now() + 30 * 60_000) });
  const descriptions = coverage.conflicts.map((conflict) => t("teamWork.coverageConflict", { member: escapeTimeOffDiscordText(conflict.memberName), duty: t(conflict.dutyRole === "vip" ? "trainDuty.vip" : "trainDuty.conductor"), date: new Intl.DateTimeFormat(actor.locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${conflict.dutyDate}T12:00:00Z`)) }));
  return { content: `${descriptions.join("\n")}\n${t("teamWork.keepHint")}`, components: [{ type: 1, components: [{ type: 2, style: 2, label: t("teamWork.keep"), custom_id: `coverage:${token}` }] }] };
}

export async function handleDiscordCoverage(payload: DiscordInteractionPayload): Promise<NextResponse> {
  const discordUserId = interactionDiscordUserId(payload);
  const guildId = interactionGuildId(payload);
  const locale = await getDiscordBotLocale(discordUserId ?? "", payload.locale);
  const t = createDiscordTranslator(locale);
  const reply = (content: string, components: unknown[] = []) => NextResponse.json({ type: 4, data: { content, components, flags: 64, allowed_mentions: { parse: [] } } });
  if (!discordUserId || !guildId) return reply(t("errors.notOfficer"));
  const allianceId = await resolveAllianceForGuild(guildId);
  if (!allianceId || !(await callerCanManageTrains({ allianceId, discordUserId }))) return reply(t("errors.notOfficer"));
  const token = payload.data?.custom_id?.match(/^coverage:([a-zA-Z0-9_-]{21})$/)?.[1];
  if (!token) return reply(t("train.pickExpired"));
  const [row] = await getDb().select({ state: schema.timeOffDiscordInteractions.state }).from(schema.timeOffDiscordInteractions).where(and(eq(schema.timeOffDiscordInteractions.id, token), eq(schema.timeOffDiscordInteractions.allianceId, allianceId), eq(schema.timeOffDiscordInteractions.guildId, guildId), eq(schema.timeOffDiscordInteractions.discordUserId, discordUserId), gt(schema.timeOffDiscordInteractions.expiresAt, new Date()))).limit(1);
  const state = row?.state as State | undefined;
  if (state?.kind !== "train_coverage") return reply(t("train.pickExpired"));
  if (payload.type === 3) return NextResponse.json({ type: 9, data: { custom_id: `coverage:${token}`, title: t("teamWork.keep"), components: [{ type: 1, components: [{ type: 4, custom_id: "note", style: 2, label: t("teamWork.auditReason"), required: true, max_length: 500 }] }] } });
  if (payload.type !== 5) return reply(t("train.pickExpired"));
  const note = payload.data?.components?.flatMap((row) => row.components ?? []).find((component) => component.custom_id === "note")?.value ?? "";
  const hqUserId = await resolveDiscordHqUserId(discordUserId);
  try {
    let boardingRecordId: string | undefined;
    await withCoverageActor({ allianceId, discordUserId, hqUserId, acceptance: { conflicts: state.conflicts, note, requestId: token } }, async () => {
      if (!(await callerCanManageTrains({ allianceId, discordUserId }))) throw new CoverageConflictError([]);
      if (state.action === "pick" && state.memberId && state.memberName) await draftConductorForAlliance({ allianceId, date: state.date, memberId: state.memberId, memberName: state.memberName, allowEligibilityOverride: true });
      else if (state.action === "lock") boardingRecordId = (await lockTrainAndAnnounce({ allianceId, guildId, date: state.date, locale, lockedByHqUserId: hqUserId })).record.id;
      else throw new CoverageConflictError([]);
    });
    if (boardingRecordId) {
      const prompt = await boardingDiscordPrompt({ allianceId, guildId, discordUserId, locale, recordId: boardingRecordId });
      if (prompt) return reply(prompt.content, prompt.components);
    }
    return reply(t(state.action === "pick" ? "train.draftSaved" : "train.readyLocked", { name: escapeTimeOffDiscordText(state.memberName ?? state.conflicts[0]?.memberName ?? ""), date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${state.date}T12:00:00Z`)) }));
  } catch (error) {
    if (error instanceof CoverageConflictError && error.conflicts.length) {
      const updated = await showDiscordCoverage({ allianceId, guildId, discordUserId, locale }, { ...state, conflicts: error.conflicts });
      return reply(updated.content, updated.components);
    }
    return reply(t("timeOff.workflow.errors.staleEntry"));
  }
}
