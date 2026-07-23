"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import type { SerializedTimeOffEntry } from "@/lib/time-off/types.shared";

type ReportPayload = {
  unexpected: SerializedTimeOffEntry[];
  unannounced: Array<{ ashedMemberId: string; memberName: string }>;
};

type Props = {
  initialReport: ReportPayload | undefined;
  onChanged: () => void;
};

export function UnexpectedAbsencePanel({ initialReport, onChanged }: Props) {
  const t = useTranslations("timeOff");
  const [report, setReport] = useState<ReportPayload | null>(
    initialReport ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/time-off/unexpected-absence");
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? t("errors.reportFailed"));
        return;
      }
      const payload = (await response.json()) as ReportPayload & {
        asOfDate: string;
      };
      setReport({
        unexpected: payload.unexpected,
        unannounced: payload.unannounced,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  return (
    <section className="rounded-lg border border-hq-border bg-hq-bg p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-hq-fg">
            {t("unexpectedReport.title")}
          </h2>
          <p className="text-xs text-hq-fg-muted">{t("unexpectedReport.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void load();
            onChanged();
          }}
          disabled={loading}
          className="rounded border border-hq-border px-3 py-1.5 text-xs text-hq-fg"
        >
          {t("unexpectedReport.refresh")}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-rose-700 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
              {t("unexpectedReport.flaggedTitle")}
            </h3>
            {report.unexpected.length === 0 ? (
              <p className="mt-2 text-sm text-hq-fg-muted">
                {t("unexpectedReport.flaggedEmpty")}
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {report.unexpected.map((entry) => (
                  <li key={entry.id} className="rounded border border-hq-border px-2 py-1.5">
                    <div className="font-medium text-hq-fg">{entry.memberName}</div>
                    <div className="text-hq-fg-muted">
                      {entry.startDate} → {entry.endDate}
                    </div>
                    {entry.notes ? (
                      <div className="text-hq-fg-muted">{entry.notes}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
              {t("unexpectedReport.unannouncedTitle")}
            </h3>
            {report.unannounced.length === 0 ? (
              <p className="mt-2 text-sm text-hq-fg-muted">
                {t("unexpectedReport.unannouncedEmpty")}
              </p>
            ) : (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-hq-fg-muted">
                {report.unannounced.map((member) => (
                  <li key={member.ashedMemberId}>{member.memberName}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
