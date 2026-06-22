import { truncateDiscordContent } from "@/lib/discord/post-message.server";
import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import {
  buildTakedownTeams,
  formatTakedownReport,
  formatVrLeaderboard,
} from "@/lib/vr/leaderboard";
import { loadAllianceLeaderboard } from "@/lib/vr/leaderboard.server";
import { writeDiscordBotAudit } from "@/lib/vr/repository";

export async function handleDiscordVrReport(input: {
  allianceId: string;
  discordUserId: string;
  commandName?: "vr-report" | "takedown-teams";
  teamCount?: number;
  locale: DiscordBotLocale;
}): Promise<{ reply: string }> {
  const t = createDiscordTranslator(input.locale);

  if (
    input.commandName === "takedown-teams" &&
    (input.teamCount == null || input.teamCount <= 0)
  ) {
    return { reply: t("errors.teamsRequired") };
  }

  const allowed = await callerCanRunVrReport({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    return { reply: t("errors.notOfficer") };
  }

  const { seasonKey, allianceTag, rows } = await loadAllianceLeaderboard(
    input.allianceId,
  );

  let reply: string;
  if (input.teamCount != null && input.teamCount > 0) {
    const result = buildTakedownTeams(rows, input.teamCount);
    if (!result.ok) {
      reply = t("errors.insufficientForTeams", {
        teams: input.teamCount,
        needed: result.needed,
        have: result.have,
      });
    } else {
      reply = formatTakedownReport(result.teams, seasonKey, allianceTag);
    }
  } else {
    reply = formatVrLeaderboard(rows, seasonKey, { limit: 25, allianceTag });
  }

  try {
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: input.teamCount ? "vr_report_teams" : "vr_report",
      payload: { teamCount: input.teamCount ?? null },
      result: { rowCount: rows.length },
    });
  } catch (error) {
    console.error("[discord-bot] vr report audit failed", error);
  }

  return { reply: truncateDiscordContent(reply) };
}
