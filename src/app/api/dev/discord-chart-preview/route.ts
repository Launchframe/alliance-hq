import { NextResponse, type NextRequest } from "next/server";

import {
  fixtureThpHistoryEvents,
  fixtureVrProgressSeries,
} from "@/lib/charts/chart-preview-fixtures.shared";
import {
  renderThpHistoryChartPng,
  renderVrProgressChartPng,
} from "@/lib/charts/render-chart-png.server";
import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { buildThpHistoryChartSvg } from "@/lib/thp/thp-history-chart-render.shared";
import {
  THP_HISTORY_CHART_DISCORD_HEIGHT,
  THP_HISTORY_CHART_DISCORD_WIDTH,
} from "@/lib/thp/thp-history-chart-render.shared";
import { buildVrProgressChartSvg } from "@/lib/vr/vr-progress-chart-render.shared";
import {
  VR_PROGRESS_CHART_DISCORD_HEIGHT,
  VR_PROGRESS_CHART_DISCORD_WIDTH,
} from "@/lib/vr/vr-progress-chart-render.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Developer preview of Discord chart PNGs (fixture data).
 * GET /api/dev/discord-chart-preview?kind=vr|thp&format=png|svg&locale=en-US|pt-BR
 */
export async function GET(request: NextRequest) {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const kind = request.nextUrl.searchParams.get("kind") ?? "vr";
  const format = request.nextUrl.searchParams.get("format") ?? "png";
  const localeParam = request.nextUrl.searchParams.get("locale");
  const locale =
    localeParam === "pt-BR" || localeParam === "en-US" ? localeParam : "en-US";
  if (kind !== "vr" && kind !== "thp") {
    return NextResponse.json(
      { error: "kind must be vr or thp" },
      { status: 400 },
    );
  }
  if (format !== "png" && format !== "svg") {
    return NextResponse.json(
      { error: "format must be png or svg" },
      { status: 400 },
    );
  }

  const now = new Date("2026-07-16T18:00:00.000Z");
  const nowLabel = locale === "pt-BR" ? "Agora" : "Now";

  if (kind === "vr") {
    const fixture = fixtureVrProgressSeries(now);
    const viewerId = fixture.series.find((row) => row.isViewer)?.commanderId;
    const visibleCommanderIds = viewerId ? [viewerId] : undefined;
    const svg = buildVrProgressChartSvg({
      series: fixture.series,
      seasonKey: fixture.seasonKey,
      width: VR_PROGRESS_CHART_DISCORD_WIDTH,
      height: VR_PROGRESS_CHART_DISCORD_HEIGHT,
      now,
      locale,
      options: { labels: { nowLabel }, visibleCommanderIds },
    });
    if (!svg) {
      return NextResponse.json({ error: "empty_chart" }, { status: 500 });
    }
    if (format === "svg") {
      return new NextResponse(svg, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    const png = await renderVrProgressChartPng({
      series: fixture.series,
      seasonKey: fixture.seasonKey,
      now,
      nowLabel,
      locale,
      visibleCommanderIds,
    });
    if (!png) {
      return NextResponse.json({ error: "empty_chart" }, { status: 500 });
    }
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  }

  const events = fixtureThpHistoryEvents(now);
  const svg = buildThpHistoryChartSvg({
    events,
    width: THP_HISTORY_CHART_DISCORD_WIDTH,
    height: THP_HISTORY_CHART_DISCORD_HEIGHT,
    locale,
  });
  if (!svg) {
    return NextResponse.json({ error: "empty_chart" }, { status: 500 });
  }
  if (format === "svg") {
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  const png = await renderThpHistoryChartPng({ events, locale });
  if (!png) {
    return NextResponse.json({ error: "empty_chart" }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
