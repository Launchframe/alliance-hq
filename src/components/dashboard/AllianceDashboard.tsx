"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import {
  buildVrHistogramBuckets,
  HistogramChart,
} from "@/components/analytics/HistogramChart";
import { LinkProgressChart } from "@/components/analytics/LinkProgressChart";
import { PercentileBandChart } from "@/components/analytics/PercentileBandChart";
import { DistributionPieChart } from "@/components/analytics/DistributionPieChart";
import { SquadPowerBarChart } from "@/components/analytics/SquadPowerBarChart";
import type { DashboardSummaryPayload } from "@/lib/analytics/dashboard-summary.shared";
import { Link } from "@/i18n/navigation";
import { MEMBER_LINK_HELP_INBOX_KIND } from "@/lib/member-link/member-link-help-inbox.shared";
import { ONBOARDING_REVIEW_INBOX_KIND } from "@/lib/member-link/onboarding-review-inbox.shared";
import { ROSTER_LINK_INBOX_KIND } from "@/lib/member-link/roster-link-inbox.shared";

function snapshotToThpSeries(
  series: DashboardSummaryPayload["thpSeries"],
): Array<{ date: string; total: number | null; p50: number | null; p90: number | null; p99: number | null }> {
  return series.map((row) => ({
    date: row.recordedDate,
    total: row.thpTotal,
    p50: row.thpP50,
    p90: row.thpP90,
    p99: row.thpP99,
  }));
}

function snapshotToDonationSeries(
  series: DashboardSummaryPayload["donationSeries"],
) {
  return series
    .filter((row) => row.donationTotal != null)
    .map((row) => ({
      date: row.recordedDate,
      total: row.donationTotal,
      p50: row.donationP50,
      p90: row.donationP90,
      p99: row.donationP99,
    }));
}

export function AllianceDashboard({
  initialSummary = null,
  initialVr = null,
}: {
  initialSummary?: DashboardSummaryPayload | null;
  initialVr?: {
    available: boolean;
    values?: number[];
    reporterCount?: number;
    activeMemberCount?: number;
    viewer?: { highestBaseVr: number | null };
  } | null;
}) {
  const t = useTranslations("dashboard");
  const tInbox = useTranslations("inbox");
  const [data, setData] = useState<DashboardSummaryPayload | null>(initialSummary);
  const [vrData, setVrData] = useState<{
    available: boolean;
    values?: number[];
    reporterCount?: number;
    activeMemberCount?: number;
    viewer?: { highestBaseVr: number | null };
  } | null>(initialVr);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSummary) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [summaryRes, vrRes] = await Promise.all([
          fetch("/api/dashboard/summary"),
          fetch("/api/dashboard/viral-resistance"),
        ]);
        if (cancelled) return;
        if (!summaryRes.ok) throw new Error(t("loadFailed"));
        const summary = (await summaryRes.json()) as DashboardSummaryPayload;
        setData(summary);
        if (vrRes.ok) {
          setVrData(await vrRes.json());
        }
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSummary, t]);

  const linkProgress = useMemo(() => {
    if (!data) return [];
    return data.linkProgressSeries
      .filter((row) => row.activeMemberCount > 0)
      .map((row) => ({
        date: row.recordedDate,
        value: row.linkedCount / row.activeMemberCount,
      }));
  }, [data]);

  const squadSlices = useMemo(() => {
    if (!data) return [];
    const summary = data.squad.summaryBySquad;
    return [
      { key: "aircraft", label: t("squad.aircraft"), count: summary.aircraft.count },
      { key: "tank", label: t("squad.tank"), count: summary.tank.count },
      { key: "missile", label: t("squad.missile"), count: summary.missile.count },
      { key: "unreported", label: t("squad.unreported"), count: summary.unreported.count },
    ];
  }, [data, t]);

  const squadPowerRows = useMemo(() => {
    if (!data) return [];
    const power = data.squad.squadPower;
    const viewerSquad =
      data.viewer.mainSquad ??
      (data.viewer.mainSquad == null ? "unreported" : null);
    return [
      { key: "aircraft", label: t("squad.aircraft"), value: power.aircraft },
      { key: "tank", label: t("squad.tank"), value: power.tank },
      { key: "missile", label: t("squad.missile"), value: power.missile },
      { key: "unreported", label: t("squad.unreported"), value: power.unreported },
    ].map((row) => ({
      ...row,
      isViewer: viewerSquad === row.key,
    }));
  }, [data, t]);

  const vrBuckets = useMemo(() => {
    if (!vrData?.available || !vrData.values) return [];
    return buildVrHistogramBuckets(
      vrData.values,
      vrData.viewer?.highestBaseVr ?? null,
    );
  }, [vrData]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-hq-border bg-hq-surface px-4 py-8 text-center text-sm text-hq-fg-muted">
        {t("loading")}
      </div>
    );
  }

  function kindLabel(kind: string): string {
    if (kind === "eur_occurrence") return tInbox("kind.eurOccurrence");
    if (kind === "video_jobs_pending") return tInbox("kind.videoJobsPending");
    if (kind === ROSTER_LINK_INBOX_KIND) return tInbox("kind.memberLinkRequest");
    if (kind === ONBOARDING_REVIEW_INBOX_KIND) return tInbox("kind.memberOnboardingReview");
    if (kind === MEMBER_LINK_HELP_INBOX_KIND) return tInbox("kind.memberLinkHelp");
    return kind;
  }

  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        {data.viewer.memberName ? (
          <p className="mt-2 text-sm text-hq-accent">
            {t("viewingAs", { name: data.viewer.memberName })}
          </p>
        ) : (
          <p className="mt-2 text-sm text-hq-fg-muted">{t("linkToSeeStanding")}</p>
        )}
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <AnalyticsCard
          title={t("inbox.title")}
          description={t("inbox.description")}
          href="/inbox"
          linkLabel={t("viewAll")}
        >
          {data.inbox.length === 0 ? (
            <p className="text-sm text-hq-fg-muted">{t("inbox.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {data.inbox.map((item) => (
                <li key={item.id} className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-hq-fg-muted">
                    {kindLabel(item.kind)}
                  </p>
                  <p className="text-sm text-hq-fg">{item.title}</p>
                  {item.href ? (
                    <Link href={item.href} className="mt-1 inline-block text-xs text-hq-accent hover:underline">
                      {t("openItem")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {data.attention ? (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {data.attention.rosterLinkRequests > 0 ? (
                <Link href="/members/roster-link-requests" className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-200">
                  {t("inbox.rosterLinks", { count: data.attention.rosterLinkRequests })}
                </Link>
              ) : null}
              {data.attention.memberLinkHelp > 0 ? (
                <Link href="/members/member-link-help" className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-200">
                  {t("inbox.helpRequests", { count: data.attention.memberLinkHelp })}
                </Link>
              ) : null}
            </div>
          ) : null}
        </AnalyticsCard>

        <AnalyticsCard title={t("train.title")} href="/trains" linkLabel={t("openTrains")}>
          {data.trainStatus.state === "no_template" ? (
            <div>
              <p className="text-sm text-hq-fg-muted">{t("train.noTemplate")}</p>
              {data.canManageTrains ? (
                <Link href="/trains" className="mt-3 inline-flex rounded-lg bg-hq-accent px-3 py-2 text-sm text-white">
                  {t("train.selectTemplate")}
                </Link>
              ) : null}
            </div>
          ) : null}
          {data.trainStatus.state === "awaiting_conductor" ? (
            <div>
              <p className="text-sm text-hq-fg-muted">{t("train.awaitingConductor")}</p>
              {data.canManageTrains ? (
                <Link href="/trains" className="mt-3 inline-flex rounded-lg bg-hq-accent px-3 py-2 text-sm text-white">
                  {t("train.selectConductor")}
                </Link>
              ) : null}
            </div>
          ) : null}
          {data.trainStatus.state === "in_progress" ? (
            <div>
              <p className="text-2xl font-bold text-hq-accent">
                {data.trainStatus.conductorMemberName ?? t("train.awaitingConductor")}
              </p>
              <p className="mt-1 text-sm text-hq-fg-muted">
                {t("train.inProgress")}
                {data.trainStatus.vipMemberName
                  ? ` · VIP ${data.trainStatus.vipMemberName}`
                  : ""}
              </p>
            </div>
          ) : null}
        </AnalyticsCard>

        <AnalyticsCard title={t("video.title")} href="/tools/video-upload" linkLabel={t("uploadVideo")}>
          <ul className="space-y-2">
            {data.videoCoverage.map((target) => (
              <li
                key={target.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm"
              >
                <span>{t(`video.targets.${target.labelKey}` as "video.targets.vsPerformance")}</span>
                {target.satisfied ? (
                  <span className="text-emerald-300">{t("video.uploaded")}</span>
                ) : (
                  <Link href={target.uploadHref} className="text-hq-accent hover:underline">
                    {t("video.uploadCta")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </AnalyticsCard>
      </div>

      <AnalyticsCard
        title={t("linking.title")}
        href="/dashboard/linking"
        linkLabel={t("details")}
      >
        <LinkProgressChart
          data={linkProgress}
          viewerLinked={data.viewer.hqLinked}
        />
      </AnalyticsCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <AnalyticsCard
          title={t("thp.title")}
          href="/dashboard/hero-power"
          linkLabel={t("details")}
        >
          <PercentileBandChart
            data={snapshotToThpSeries(data.thpSeries)}
            showTotal
            viewerValue={data.viewer.totalHeroPower}
          />
        </AnalyticsCard>

        <AnalyticsCard title={t("squad.title")}>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <DistributionPieChart
              slices={squadSlices}
              viewerKey={
                data.viewer.mainSquad ??
                (data.viewer.memberId ? "unreported" : null)
              }
              />
            </div>
            <div className="min-w-0">
              <SquadPowerBarChart rows={squadPowerRows} />
            </div>
          </div>
        </AnalyticsCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AnalyticsCard
          title={t("donations.title")}
          href="/dashboard/donations"
          linkLabel={t("details")}
        >
          {!data.hasAshedConnection ? (
            <p className="text-sm text-hq-fg-muted">{t("donations.requiresAshed")}</p>
          ) : (
            <PercentileBandChart
              data={snapshotToDonationSeries(data.donationSeries)}
              showTotal
            />
          )}
        </AnalyticsCard>

        {data.vrAvailable && vrData?.available ? (
          <AnalyticsCard title={t("vr.title")} href="/my-vr" linkLabel={t("myVr")}>
            <p className="mb-3 text-sm text-hq-fg-muted">
              {t("vr.reportRate", {
                reported: vrData.reporterCount ?? 0,
                total: vrData.activeMemberCount ?? 0,
              })}
            </p>
            <HistogramChart buckets={vrBuckets} />
          </AnalyticsCard>
        ) : null}
      </div>
    </div>
  );
}
