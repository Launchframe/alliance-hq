"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { TimeOffCalendar } from "@/components/time-off/TimeOffCalendar";
import { TimeOffEntryModal } from "@/components/time-off/TimeOffEntryModal";
import { UnexpectedAbsencePanel } from "@/components/time-off/UnexpectedAbsencePanel";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type { TimeOffCalendarPayload, SerializedTimeOffEntry } from "@/lib/time-off/types.shared";

type Props = {
  initial: TimeOffCalendarPayload;
};

export function TimeOffCalendarClient({ initial }: Props) {
  const t = useTranslations("timeOff");
  const [dashboard, setDashboard] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<SerializedTimeOffEntry | null>(
    null,
  );
  const [naturalLanguage, setNaturalLanguage] = useState("");

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
      setSelectedEntry(null);
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
        <section className="rounded-lg border border-hq-border bg-hq-bg p-4">
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
              className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2 text-sm text-hq-fg"
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
                    setSelectedEntry(null);
                    setModalOpen(true);
                  }}
                  className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg hover:bg-hq-bg-muted"
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
        onSelectEntry={setSelectedEntry}
      />

      {dashboard.canManageOthers ? (
        <UnexpectedAbsencePanel
          initialReport={dashboard.unexpectedReport}
          onChanged={() => void refreshMonth(dashboard.monthKey)}
        />
      ) : null}

      {selectedEntry ? (
        <section className="rounded-lg border border-hq-border bg-hq-bg p-4">
          <h2 className="text-sm font-semibold text-hq-fg">
            {selectedEntry.memberName}
          </h2>
          <p className="mt-1 text-sm text-hq-fg-muted">
            {t("entry.range", {
              start: selectedEntry.startDate,
              end: selectedEntry.endDate,
            })}
          </p>
          <p className="text-sm text-hq-fg-muted">
            {t(`availability.${selectedEntry.availability}`)}
          </p>
          {selectedEntry.notes ? (
            <p className="mt-2 text-sm text-hq-fg">{selectedEntry.notes}</p>
          ) : null}
          {(dashboard.canManageOthers ||
            dashboard.linkedCommanderIds.includes(selectedEntry.ashedMemberId)) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void cancelEntry(selectedEntry.id)}
              className="mt-3 rounded border border-rose-500/50 px-3 py-1.5 text-sm text-rose-700 dark:text-rose-300"
            >
              {t("entry.cancel")}
            </button>
          )}
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
