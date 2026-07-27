"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { TimeOffCalendar } from "@/components/time-off/TimeOffCalendar";
import { TimeOffEntryModal } from "@/components/time-off/TimeOffEntryModal";
import { UnexpectedAbsencePanel } from "@/components/time-off/UnexpectedAbsencePanel";
import { Link } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type { TimeOffCalendarPayload } from "@/lib/time-off/types.shared";

type Props = {
  initial: TimeOffCalendarPayload;
};

export function TimeOffCalendarClient({ initial }: Props) {
  const t = useTranslations("timeOff");
  const [dashboard, setDashboard] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAshedMemberId, setSelectedAshedMemberId] = useState<
    string | null
  >(null);
  const [naturalLanguage, setNaturalLanguage] = useState("");

  const selectedMemberPeriods = useMemo(() => {
    if (!selectedAshedMemberId) return [];
    return dashboard.entries
      .filter((entry) => entry.ashedMemberId === selectedAshedMemberId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [dashboard.entries, selectedAshedMemberId]);

  const refreshMonth = useCallback(async (monthKey: string) => {
    const response = await fetch(`/api/time-off?month=${monthKey}`);
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? t("errors.loadFailed"));
      return;
    }
    const data = (await response.json()) as TimeOffCalendarPayload;
    setDashboard(data);
    setError(null);
  }, [t]);

  const submitNaturalLanguage = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/time-off/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naturalLanguage }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? t("errors.saveFailed"));
        return;
      }
      setNaturalLanguage("");
      await refreshMonth(dashboard.monthKey);
    } finally {
      setSaving(false);
    }
  };

  const cancelEntry = async (entryId: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/time-off/entries/${entryId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? t("errors.saveFailed"));
        return;
      }
      await refreshMonth(dashboard.monthKey);
    } finally {
      setSaving(false);
    }
  };

  const canSelfReport =
    dashboard.linkedCommanderIds.length > 0 || dashboard.canManageOthers;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </header>

      {error ? (
        <div
          className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {canSelfReport ? (
        <section className="rounded-lg border border-hq-border bg-hq-surface p-4">
          <h2 className="text-sm font-medium text-hq-fg">{t("form.title")}</h2>
          <p className="mt-1 text-xs text-hq-fg-muted">{t("form.hint")}</p>
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void submitNaturalLanguage();
            }}
          >
            <textarea
              value={naturalLanguage}
              onChange={(event) => setNaturalLanguage(event.target.value)}
              rows={3}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              placeholder={t("form.placeholder")}
              className="w-full rounded border border-hq-border bg-hq-surface px-3 py-2 text-sm text-hq-fg"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving || !naturalLanguage.trim()}
                className="rounded bg-hq-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {t("form.submit")}
              </button>
              {dashboard.canManageOthers ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAshedMemberId(null);
                    setModalOpen(true);
                  }}
                  className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted"
                >
                  {t("form.officerEntry")}
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      <TimeOffCalendar
        entries={dashboard.entries}
        monthKey={dashboard.monthKey}
        todayServerDate={dashboard.todayServerDate}
        onMonthChange={(monthKey) => void refreshMonth(monthKey)}
        onSelectEntry={(entry) => setSelectedAshedMemberId(entry.ashedMemberId)}
      />

      {dashboard.canManageOthers ? (
        <UnexpectedAbsencePanel initialReport={dashboard.unexpectedReport} />
      ) : null}

      {dashboard.canManageOthers ? (
        <p className="text-sm text-hq-fg-muted">
          <Link href="/vs-compliance" className="text-hq-accent hover:underline">
            {t("vsComplianceLink")}
          </Link>
        </p>
      ) : null}

      {selectedMemberPeriods.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-hq-border bg-hq-surface p-4">
          <h2 className="text-sm font-semibold text-hq-fg">
            {selectedMemberPeriods[0]!.memberName}
          </h2>
          <div className="space-y-2">
            {selectedMemberPeriods.map((period) => {
              const isActive =
                dashboard.todayServerDate >= period.startDate &&
                dashboard.todayServerDate <= period.endDate;
              const canCancel =
                dashboard.canManageOthers ||
                dashboard.linkedCommanderIds.includes(period.ashedMemberId);
              return (
                <div
                  key={period.id}
                  className="rounded border border-hq-border bg-hq-surface p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-hq-fg">
                        {t("entry.range", {
                          start: period.startDate,
                          end: period.endDate,
                        })}
                      </span>
                      {isActive ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          {t("entry.active")}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-hq-border px-2 py-0.5 text-[10px] font-medium text-hq-fg-muted">
                        {t(`activityScope.${period.activityScope}`)}
                      </span>
                    </div>
                    {canCancel ? (
                      <button
                        type="button"
                        disabled={saving}
                        aria-label={t("entry.cancel")}
                        onClick={() => void cancelEntry(period.id)}
                        className="rounded border border-rose-500/50 p-1.5 text-rose-700 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-hq-fg-muted">
                    {t(`availability.${period.availability}`)}
                  </p>
                  {period.notes ? (
                    <p className="mt-1 text-sm text-hq-fg">{period.notes}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <TimeOffEntryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          void refreshMonth(dashboard.monthKey);
        }}
      />
    </div>
  );
}
