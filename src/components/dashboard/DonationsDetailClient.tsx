"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { PercentileBandChart } from "@/components/analytics/PercentileBandChart";
import { Link } from "@/i18n/navigation";

type Range = "30d" | "90d" | "all";

type Payload = {
  hasAshedConnection: boolean;
  range: Range;
  series: Array<{
    recordedDate: string;
    donationTotal: number | null;
    donationP50: number | null;
    donationP90: number | null;
    donationP99: number | null;
  }>;
};

export function DonationsDetailClient() {
  const t = useTranslations("dashboard.donationsPage");
  const [range, setRange] = useState<Range>("90d");
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/dashboard/donations?range=${range}`);
      if (cancelled || !res.ok) return;
      setData(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

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
      </header>

      {!data.hasAshedConnection ? (
        <p className="rounded-xl border border-hq-border bg-hq-surface px-4 py-3 text-sm text-hq-fg-muted">
          {t("requiresAshed")}
        </p>
      ) : (
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
          <PercentileBandChart
            data={data.series
              .filter((row) => row.donationTotal != null)
              .map((row) => ({
                date: row.recordedDate,
                total: row.donationTotal,
                p50: row.donationP50,
                p90: row.donationP90,
                p99: row.donationP99,
              }))}
            showTotal
            valueFormatter={(value) => value.toLocaleString()}
          />
        </AnalyticsCard>
      )}
    </div>
  );
}
