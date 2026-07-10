"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { PercentileBandChart } from "@/components/analytics/PercentileBandChart";
import { Link } from "@/i18n/navigation";

type Range = "30d" | "90d" | "all";

type Payload = {
  viewer: {
    memberId: string | null;
    memberName: string | null;
    totalHeroPower: number | null;
  };
  standing: { rank: number; count: number; percentile: number } | null;
  range: Range;
  today: string;
  series: Array<{
    recordedDate: string;
    thpTotal: number | null;
    thpP50: number | null;
    thpP90: number | null;
    thpP99: number | null;
  }>;
  table: Array<{
    ashedMemberId: string;
    memberName: string;
    totalHeroPower: number;
  }>;
};

export function HeroPowerDetailClient() {
  const t = useTranslations("dashboard.heroPowerPage");
  const [range, setRange] = useState<Range>("90d");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/dashboard/hero-power?range=${range}`);
        if (cancelled) return;
        if (!res.ok) throw new Error(t("loadFailed"));
        setData(await res.json());
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
  }, [range, t]);

  if (error) {
    return <p className="text-sm text-red-200">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;
  }

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-hq-accent hover:underline">
            ← {t("back")}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-hq-fg">{t("title")}</h1>
          {data.standing ? (
            <p className="mt-1 text-sm text-hq-fg-muted">
              {t("standing", {
                rank: data.standing.rank,
                total: data.standing.count,
                percentile: data.standing.percentile,
              })}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
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
      </header>

      <AnalyticsCard title={t("chartTitle")}>
        <PercentileBandChart
          data={data.series.map((row) => ({
            date: row.recordedDate,
            total: row.thpTotal,
            p50: row.thpP50,
            p90: row.thpP90,
            p99: row.thpP99,
          }))}
          showTotal
          viewerValue={data.viewer.totalHeroPower}
          viewerDate={data.today}
        />
      </AnalyticsCard>

      <AnalyticsCard title={t("tableTitle")}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-hq-border text-left text-hq-fg-muted">
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">{t("member")}</th>
                <th className="py-2">{t("thp")}</th>
              </tr>
            </thead>
            <tbody>
              {data.table.slice(0, 50).map((row, index) => {
                const isViewer = row.ashedMemberId === data.viewer.memberId;
                return (
                  <tr
                    key={row.ashedMemberId}
                    className={`border-b border-hq-border/60 ${
                      isViewer ? "bg-[#f78166]/10" : ""
                    }`}
                  >
                    <td className="py-2 pr-4 text-hq-fg-muted">{index + 1}</td>
                    <td className="py-2 pr-4 text-hq-fg">
                      {row.memberName}
                      {isViewer ? ` (${t("you")})` : ""}
                    </td>
                    <td className="py-2 text-hq-fg">{row.totalHeroPower.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AnalyticsCard>
    </div>
  );
}
