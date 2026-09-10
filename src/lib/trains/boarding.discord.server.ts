import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getTranslations } from "next-intl/server";
import { getDb, schema } from "@/lib/db";
import { getDiscordBotLocale } from "@/lib/discord/i18n";
import { interactionDiscordUserId, interactionGuildId, type DiscordInteractionPayload } from "@/lib/discord/interactions";
import { CalendarError } from "@/lib/calendar/types.shared";
import { callerCanManageTrains } from "./discord-bot-auth.server";
import { readBoarding, submitBoarding } from "./boarding.server";
import { parseBoardingCountdown } from "./boarding.shared";

export async function boardingDiscordPrompt(input: { allianceId: string; guildId: string; discordUserId: string; recordId: string; locale: string }) {
  if (!await callerCanManageTrains(input)) throw new CalendarError("forbidden", 403);
  const window = await readBoarding(input.allianceId, input.recordId, `discord:${input.discordUserId}`);
  if (!window) return null;
  const t = await getTranslations({ locale: input.locale, namespace: "calendarConnections" });
  const active = await getDb().select({ id: schema.trainBoardingPrompts.id }).from(schema.trainBoardingPrompts).where(and(eq(schema.trainBoardingPrompts.discordUserId, input.discordUserId), gt(schema.trainBoardingPrompts.expiresAt, new Date()))).limit(51);
  if (active.length >= 50) throw new CalendarError("rate_limit", 429);
  const id = nanoid();
  await getDb().insert(schema.trainBoardingPrompts).values({ id, allianceId: input.allianceId, guildId: input.guildId, discordUserId: input.discordUserId, recordId: input.recordId, state: { clockToken: window.clockToken, version: window.version, serverNow: window.serverNow }, expiresAt: new Date(Date.now() + 15 * 60_000) });
  return { content: `${t("boarding.question")}\n${t("boarding.hint")}\n${t("boarding.skipHint")}`, components: [{ type: 1, components: [{ type: 2, style: 1, label: t("boarding.submit"), custom_id: `boarding:${id}:open` }, { type: 2, style: 2, label: t("skip"), custom_id: `boarding:${id}:skip` }] }] };
}

async function context(payload: DiscordInteractionPayload) {
  const discordUserId = interactionDiscordUserId(payload), guildId = interactionGuildId(payload);
  const parsed = /^boarding:([\w-]{21}):(open|skip|submit)$/.exec(payload.data?.custom_id ?? "");
  if (!discordUserId || !guildId || !parsed) throw new CalendarError("forbidden", 403);
  const [prompt] = await getDb().select().from(schema.trainBoardingPrompts).where(and(eq(schema.trainBoardingPrompts.id, parsed[1]), eq(schema.trainBoardingPrompts.discordUserId, discordUserId), eq(schema.trainBoardingPrompts.guildId, guildId), gt(schema.trainBoardingPrompts.expiresAt, new Date())));
  if (!prompt) throw new CalendarError("expired", 409);
  const [guild] = await getDb().select().from(schema.discordGuildAlliances).where(and(eq(schema.discordGuildAlliances.guildId, guildId), eq(schema.discordGuildAlliances.allianceId, prompt.allianceId)));
  if (!guild || !await callerCanManageTrains({ allianceId: prompt.allianceId, discordUserId })) throw new CalendarError("forbidden", 403);
  return { prompt, action: parsed[2], actorId: `discord:${discordUserId}` };
}

export async function handleBoardingDiscord(payload: DiscordInteractionPayload) {
  const locale = await getDiscordBotLocale(interactionDiscordUserId(payload) ?? "", payload.locale);
  const t = await getTranslations({ locale, namespace: "calendarConnections" });
  try {
    const { prompt, action, actorId } = await context(payload);
    if (payload.type === 3 && action === "open") return { type: 9, data: { custom_id: `boarding:${prompt.id}:submit`, title: t("boarding.title"), components: [{ type: 1, components: [{ type: 4, style: 1, custom_id: "countdown", label: t("boarding.question"), placeholder: "00:00:00", required: true, min_length: 8, max_length: 8 }] }] } };
    if (!(payload.type === 3 && action === "skip") && !(payload.type === 5 && action === "submit")) throw new CalendarError("invalid_countdown");
    const countdown = action === "skip" ? null : payload.data?.components?.flatMap((row) => row.components ?? []).find((row) => row.custom_id === "countdown")?.value;
    if (countdown !== null) { try { parseBoardingCountdown(countdown); } catch { throw new CalendarError("invalid_countdown"); } }
    const state = await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(schema.trainBoardingPrompts).where(eq(schema.trainBoardingPrompts.id, prompt.id)).for("update");
      if (!current || current.expiresAt <= new Date()) throw new CalendarError("expired", 409);
      if (current.state.observedAt !== undefined) {
        if (current.state.countdown !== countdown) throw new CalendarError("stale", 409);
        return current.state;
      }
      const state = { ...current.state, observedAt: Date.now(), countdown: countdown as string | null };
      await tx.update(schema.trainBoardingPrompts).set({ state }).where(eq(schema.trainBoardingPrompts.id, prompt.id));
      return state;
    });
    const saved = await submitBoarding(prompt.allianceId, actorId, { recordId: prompt.recordId, version: state.version, requestId: `boarding-${prompt.id}`, clockToken: state.clockToken, elapsedMs: state.observedAt! - Date.parse(state.serverNow), countdown: state.countdown ?? null });
    return { type: 4, data: { content: saved.status === "closed" ? t("boarding.closed") : t("boarding.ends", { time: `<t:${Math.floor(saved.endsAt!.getTime() / 1000)}:F>` }), flags: 64, allowed_mentions: { parse: [] } } };
  } catch (error) {
    return { type: 4, data: { content: t(error instanceof CalendarError && error.code === "invalid_countdown" ? "boarding.invalid" : error instanceof CalendarError && error.code === "expired" ? "boarding.expired" : "stale"), flags: 64, allowed_mentions: { parse: [] } } };
  }
}
