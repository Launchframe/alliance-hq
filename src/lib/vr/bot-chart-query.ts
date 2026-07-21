import "server-only";

import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { parseThpBreakdownInput } from "@/lib/thp/breakdown.shared";
import type { MyThpEvent } from "@/lib/thp/my-thp.shared";
import {
  getCommanderIdForMember,
  getCommanderThpState,
  listCommanderThpEvents,
} from "@/lib/thp/repository";
import {
  renderThpHistoryChartPng,
  renderVrProgressChartPng,
} from "@/lib/charts/render-chart-png.server";
import { effectiveBaseVr } from "@/lib/vr/effective-vr.shared";
import { instituteLevelForBaseVr } from "@/lib/vr/institute-levels.shared";
import { listDiscordLinksForStatusQuery } from "@/lib/vr/bot-member-links.server";
import {
  listVrProgressChartCommanderCandidates,
  loadVrProgressChartPayload,
} from "@/lib/vr/load-progress-chart";
import {
  expandVrChartCommanderNameInputs,
  resolveVrChartCommanderNames,
} from "@/lib/vr/vr-chart-resolve-commanders.shared";
import {
  getCommanderByAshedMemberId,
  getMemberSeasonHigh,
  resolveSeasonKey,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";

/** Viewer plus up to four named allies on the Discord VR chart. */
export const VR_CHART_MAX_VISIBLE_COMMANDERS = 5;

export type ChartQueryResult =
  | {
      ok: true;
      content: string;
      files: Array<{ filename: string; bytes: Buffer; contentType: string }>;
    }
  | { ok: false; content: string };

async function auditChart(
  allianceId: string,
  discordUserId: string,
  command: string,
  result: { content: string; ok: boolean },
) {
  try {
    await writeDiscordBotAudit({
      allianceId,
      discordUserId,
      command,
      payload: {},
      result: { reply: result.content, ok: result.ok },
    });
  } catch (error) {
    console.error(`[discord-bot] ${command} audit failed`, error);
  }
}

function mapThpEvents(
  events: Awaited<ReturnType<typeof listCommanderThpEvents>>,
): MyThpEvent[] {
  return events.map((event) => ({
    total: event.total,
    breakdown: parseThpBreakdownInput(event.breakdown),
    previousTotal: event.previousTotal,
    createdAt: event.createdAt.toISOString(),
    source: event.source,
  }));
}

/** Channel-visible VR progress chart PNG for the caller's linked commander. */
export async function handleDiscordWhatIsMyVrChart(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  /** Optional alliance commander names to overlay on the chart. */
  additionalCommanderNames?: string[];
}): Promise<ChartQueryResult> {
  const t = createDiscordTranslator(input.locale);
  const links = await listDiscordLinksForStatusQuery(
    input.allianceId,
    input.discordUserId,
  );
  if (links.length === 0) {
    const result = { ok: false as const, content: t("chart.vrNotLinked") };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_vr_chart", result);
    return result;
  }

  const primary = links[0]!;
  const commander = await getCommanderByAshedMemberId(
    primary.ashedMemberId,
    input.allianceId,
  );
  const viewerCommanderId =
    commander?.commanderId ?? null;

  const requestedNames = expandVrChartCommanderNameInputs(
    input.additionalCommanderNames ?? [],
  );
  const catalog = await listVrProgressChartCommanderCandidates(input.allianceId);
  const resolved = resolveVrChartCommanderNames(requestedNames, catalog);

  if (resolved.notFound.length > 0) {
    const result = {
      ok: false as const,
      content: t("chart.vrCommanderNotFound", {
        names: resolved.notFound.join(", "),
      }),
    };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_vr_chart", result);
    return result;
  }
  if (resolved.ambiguous.length > 0) {
    const detail = resolved.ambiguous
      .map((row) => `${row.query} (${row.memberNames.join(", ")})`)
      .join("; ");
    const result = {
      ok: false as const,
      content: t("chart.vrCommanderAmbiguous", { detail }),
    };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_vr_chart", result);
    return result;
  }

  const visibleCommanderIds = [
    ...(viewerCommanderId ? [viewerCommanderId] : []),
    ...resolved.commanderIds.filter((id) => id !== viewerCommanderId),
  ];
  if (visibleCommanderIds.length > VR_CHART_MAX_VISIBLE_COMMANDERS) {
    const result = {
      ok: false as const,
      content: t("chart.vrTooManyCommanders", {
        max: VR_CHART_MAX_VISIBLE_COMMANDERS,
      }),
    };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_vr_chart", result);
    return result;
  }

  const payload = await loadVrProgressChartPayload({
    allianceId: input.allianceId,
    viewerCommanderId,
    viewerAshedMemberId: primary.ashedMemberId,
    restrictToCommanderIds:
      visibleCommanderIds.length > 0 ? visibleCommanderIds : undefined,
  });

  const png = await renderVrProgressChartPng({
    series: payload.series,
    seasonKey: payload.seasonKey,
    vrUpdatesLocked: payload.vrUpdatesLocked,
    nowLabel: t("chart.nowLabel"),
    locale: input.locale,
    visibleCommanderIds:
      visibleCommanderIds.length > 0 ? visibleCommanderIds : undefined,
    showLegend: true,
  });
  if (!png) {
    const result = { ok: false as const, content: t("chart.vrInsufficientData") };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_vr_chart", result);
    return result;
  }

  const seasonKey = await resolveSeasonKey(input.allianceId);
  const captionLines: string[] = [];
  for (const link of links) {
    const name = link.memberDisplayName ?? link.ashedMemberId;
    const [seasonHigh, linkCommander] = await Promise.all([
      getMemberSeasonHigh(input.allianceId, link.ashedMemberId, seasonKey),
      getCommanderByAshedMemberId(link.ashedMemberId, input.allianceId),
    ]);
    if (seasonHigh == null) {
      captionLines.push(t("query.vrNoReport", { name }));
      continue;
    }
    const level = instituteLevelForBaseVr(seasonKey, seasonHigh) ?? "?";
    const effectiveVr = effectiveBaseVr(
      seasonHigh,
      linkCommander?.weeklyPassActive ?? false,
    );
    captionLines.push(
      t("query.vrStatus", { name, level, effectiveVr }),
    );
  }

  const content =
    links.length === 1
      ? captionLines[0]!
      : `${t("query.vrHeader")}\n${captionLines.map((line) => `• ${line}`).join("\n")}`;

  const result: ChartQueryResult = {
    ok: true,
    content,
    files: [
      {
        filename: "what-is-my-vr-chart.png",
        bytes: png,
        contentType: "image/png",
      },
    ],
  };
  await auditChart(input.allianceId, input.discordUserId, "what_is_my_vr_chart", {
    ok: true,
    content,
  });
  return result;
}

/** Channel-visible THP history chart PNG for the caller's primary linked commander. */
export async function handleDiscordWhatIsMyThpChart(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<ChartQueryResult> {
  const t = createDiscordTranslator(input.locale);
  const links = await listDiscordLinksForStatusQuery(
    input.allianceId,
    input.discordUserId,
  );
  if (links.length === 0) {
    const result = { ok: false as const, content: t("chart.thpNotLinked") };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_thp_chart", result);
    return result;
  }

  const primary = links[0]!;
  const primaryName = primary.memberDisplayName ?? primary.ashedMemberId;
  const primaryCommanderId = await getCommanderIdForMember(
    input.allianceId,
    primary.ashedMemberId,
  );
  if (!primaryCommanderId) {
    const result = {
      ok: false as const,
      content: t("query.thpNoReport", { name: primaryName }),
    };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_thp_chart", result);
    return result;
  }

  const eventRows = await listCommanderThpEvents(primaryCommanderId);
  const events = mapThpEvents(eventRows);
  const png = await renderThpHistoryChartPng({
    events,
    locale: input.locale,
  });
  if (!png) {
    const result = {
      ok: false as const,
      content: t("chart.thpInsufficientData"),
    };
    await auditChart(input.allianceId, input.discordUserId, "what_is_my_thp_chart", result);
    return result;
  }

  const captionLines: string[] = [];
  for (const link of links) {
    const name = link.memberDisplayName ?? link.ashedMemberId;
    const commanderId = await getCommanderIdForMember(
      input.allianceId,
      link.ashedMemberId,
    );
    if (!commanderId) {
      captionLines.push(t("query.thpNoReport", { name }));
      continue;
    }
    const state = await getCommanderThpState(commanderId);
    const total = state?.currentTotalHeroPower;
    if (total == null || !(total > 0)) {
      captionLines.push(t("query.thpNoReport", { name }));
      continue;
    }
    captionLines.push(
      t("query.thpStatus", {
        name,
        total: Math.round(total).toLocaleString(input.locale),
      }),
    );
  }

  const content =
    links.length === 1
      ? captionLines[0]!
      : `${t("query.thpHeader")}\n${captionLines.map((line) => `• ${line}`).join("\n")}`;

  const result: ChartQueryResult = {
    ok: true,
    content,
    files: [
      {
        filename: "what-is-my-thp-chart.png",
        bytes: png,
        contentType: "image/png",
      },
    ],
  };
  await auditChart(input.allianceId, input.discordUserId, "what_is_my_thp_chart", {
    ok: true,
    content,
  });
  return result;
}

export function isDiscordVrChartCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName === "what-is-my-vr-chart" ||
    commandName === "what-is-my-vr-progress"
  );
}

export function isDiscordThpChartCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName === "what-is-my-thp-chart" ||
    commandName === "what-is-my-thp-progress"
  );
}
