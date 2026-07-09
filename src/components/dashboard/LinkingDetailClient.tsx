"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { LinkProgressChart } from "@/components/analytics/LinkProgressChart";
import { Link } from "@/i18n/navigation";

type Range = "30d" | "90d" | "all";

type Payload = {
  viewer: { hqLinked: boolean; memberName: string | null };
  range: Range;
  latest: {
    activeMemberCount: number;
    linkedCount: number;
    unlinkedCount: number;
  } | null;
  series: Array<{
    recordedDate: string;
    activeMemberCount: number;
    linkedCount: number;
  }>;
  unlinkedMembers: Array<{
    ashedMemberId: string;
    memberName: string;
    totalHeroPower: number;
  }>;
  canWriteMembers: boolean;
};

export function LinkingDetailClient() {
  const t = useTranslations("dashboard.linkingPage");
  const [range, setRange] = useState<Range>("90d");
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/dashboard/linking?range=${range}`);
    if (res.ok) setData(await res.json());
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series
      .filter((row) => row.activeMemberCount > 0)
      .map((row) => ({
        date: row.recordedDate,
        value: row.linkedCount / row.activeMemberCount,
      }));
  }, [data]);

  if (!data) {
    return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;
  }

  return (
    <div className="space-y-6 pb-8">
      <header>
        <Link href="/dashboard" className="text-sm text-hq-accent hover:underline">
          ← {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {data.viewer.hqLinked ? t("youLinked") : t("youUnlinked")}
        </p>
      </header>

      {data.latest ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
            <p className="text-xs uppercase text-hq-fg-muted">{t("linked")}</p>
            <p className="text-2xl font-semibold text-hq-fg">{data.latest.linkedCount}</p>
          </div>
          <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
            <p className="text-xs uppercase text-hq-fg-muted">{t("unlinked")}</p>
            <p className="text-2xl font-semibold text-hq-fg">{data.latest.unlinkedCount}</p>
          </div>
          <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
            <p className="text-xs uppercase text-hq-fg-muted">{t("total")}</p>
            <p className="text-2xl font-semibold text-hq-fg">{data.latest.activeMemberCount}</p>
          </div>
        </div>
      ) : null}

      <AnalyticsCard title={t("chartTitle")}>
        <div className="mb-4 flex gap-2">
          {(["30d", "90d", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                range === option
                  ? "bg-hq-accent text-white"
                  : "border border-hq-border text-hq-fg-muted"
              }`}
            >
              {t(`range.${option}`)}
            </button>
          ))}
        </div>
        <LinkProgressChart data={chartData} viewerLinked={data.viewer.hqLinked} />
      </AnalyticsCard>

      {data.canWriteMembers && data.unlinkedMembers.length > 0 ? (
        <AnalyticsCard title={t("unlinkedTableTitle")}>
          <ul className="space-y-2 text-sm">
            {data.unlinkedMembers.slice(0, 25).map((row) => (
              <li key={row.ashedMemberId} className="flex justify-between border-b border-hq-border/60 py-2">
                <span>{row.memberName}</span>
                <span className="text-hq-fg-muted">{row.totalHeroPower.toLocaleString()} THP</span>
              </li>
            ))}
          </ul>
        </AnalyticsCard>
      ) : null}
    </div>
  );
}
