"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { TimeOffCalendar } from "@/components/time-off/TimeOffCalendar";
import { TimeOffEntryModal } from "@/components/time-off/TimeOffEntryModal";
import { UnexpectedAbsencePanel } from "@/components/time-off/UnexpectedAbsencePanel";
import { TimeOffSyncPanel } from "@/components/time-off/TimeOffSyncPanel";
import { TimeOffAshedRefreshButton } from "@/components/time-off/TimeOffAshedRefreshButton";
import { Dialog } from "@/components/ui/dialog";
import { canManageTimeOffEntry } from "@/lib/time-off/workflow.shared";
import type { TimeOffCalendarPayload, SerializedTimeOffEntry } from "@/lib/time-off/types.shared";

const buttonClass = "rounded border border-hq-border px-3 py-2 text-sm text-hq-fg disabled:opacity-50";

type Props = { initial: TimeOffCalendarPayload };

export function TimeOffCalendarClient({ initial }: Props) {
  const t = useTranslations("timeOff");
  const locale = useLocale();
  const [dashboard, setDashboard] = useState(initial);
  const [tab, setTab] = useState<"my" | "alliance">(initial.linkedCommanderIds.length ? "my" : "alliance");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ entry?: SerializedTimeOffEntry; officer: boolean } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<SerializedTimeOffEntry | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SerializedTimeOffEntry | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelUncertain, setCancelUncertain] = useState(false);
  const loadVersion = useRef(0);
  const cancelInFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const formatDate = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  const refresh = useCallback(async (monthKey: string, history: boolean, page: number) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month: monthKey, view: history ? "history" : "upcoming", page: String(page) });
      const response = await fetch(`/api/time-off?${params}`);
      const data = await response.json().catch(() => null);
      if (version !== loadVersion.current) return;
      if (!response.ok || !data?.entries) {
        setError(data?.error ?? t("workflow.errors.loadFailed"));
        return;
      }
      setDashboard(data);
      setSelectedEntry((current) => current ? [...data.entries, ...data.ownEntries].find((entry: SerializedTimeOffEntry) => entry.id === current.id) ?? null : null);
    } catch {
      if (version === loadVersion.current) setError(t("workflow.errors.loadFailed"));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [t]);

  const hasPendingSync = [...dashboard.entries, ...dashboard.ownEntries].some((entry) => entry.syncStatus === "pending" || entry.syncStatus === "cancel_pending");
  useEffect(() => {
    if (!hasPendingSync || modal || cancelTarget) return;
    const timer = setInterval(() => { void refresh(dashboard.monthKey, dashboard.history, dashboard.ownEntriesPage); }, 10_000);
    return () => clearInterval(timer);
  }, [hasPendingSync, modal, cancelTarget, refresh, dashboard.monthKey, dashboard.history, dashboard.ownEntriesPage]);
  const refreshCurrent = () => refresh(dashboard.monthKey, dashboard.history, dashboard.ownEntriesPage);
  const canManage = (entry: SerializedTimeOffEntry) => !entry.cancelledAt && canManageTimeOffEntry({
    entryKind: entry.entryKind,
    canManageOthers: dashboard.canManageOthers,
    ownsCommander: dashboard.linkedCommanderIds.includes(entry.ashedMemberId),
  });

  async function cancelEntry() {
    if (!cancelTarget || cancelInFlight.current || cancelUncertain) return;
    cancelInFlight.current = true;
    setSaving(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/time-off/entries/${cancelTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: cancelTarget.version }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.entry) {
        setCancelError(data?.error ?? t("workflow.errors.saveUnconfirmed"));
        if (!data || response.status >= 500 || data.code === "staleEntry") setCancelUncertain(true);
        return;
      }
      setCancelTarget(null);
      setSelectedEntry(null);
      setNotice(t("workflow.cancelled"));
      await refreshCurrent();
    } catch {
      setCancelError(t("workflow.errors.saveUnconfirmed"));
      setCancelUncertain(true);
    } finally {
      cancelInFlight.current = false;
      setSaving(false);
    }
  }

  function entryCard(entry: SerializedTimeOffEntry) {
    return (
      <article key={entry.id} className="space-y-2 rounded-lg border border-hq-border bg-hq-surface p-4" data-testid={`time-off-entry-${entry.id}`}>
        <h3 className="font-semibold text-hq-fg">{entry.memberName}</h3>
        <p className="text-sm text-hq-fg-muted">{t("entry.range", { start: formatDate(entry.startDate), end: formatDate(entry.endDate) })}</p>
        <p className="text-sm">{entry.cancelledAt ? t("workflow.cancelled") : entry.entryKind === "unexpected" ? t("workflow.unexpected") : !entry.globalAbsence ? t(`sync.scope.${entry.activityScope}`) : entry.entryKind === "officer_marked" ? t("workflow.officerRecorded") : t("workflow.planned")}</p>
        {entry.globalAbsence && !entry.cancelledAt && entry.startDate <= dashboard.todayServerDate && entry.endDate >= dashboard.todayServerDate ? <p className="text-sm font-medium text-hq-accent">{t("workflow.active")}</p> : null}
        {entry.notes ? <p className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">{t("workflow.privateNotes")}: </span>{entry.notes}</p> : null}
        {entry.source === "ashed" ? <p className="text-xs text-hq-fg-muted">{t("sync.fromAshed")} · {t(`sync.scope.${entry.activityScope}`)}</p> : null}
        {!entry.noticeVerified ? <p className="text-xs text-hq-fg-muted">{t("sync.noticeUnverified")}</p> : null}
        {dashboard.ashedSyncEnabled ? <TimeOffSyncPanel entryId={entry.id} version={entry.version} status={entry.syncStatus} lastSyncedAt={entry.lastSyncedAt} canManage={dashboard.canManageOthers} onChanged={() => void refreshCurrent()} /> : null}
        {canManage(entry) ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={buttonClass} onClick={() => setModal({ entry, officer: entry.entryKind !== "planned" || !dashboard.linkedCommanderIds.includes(entry.ashedMemberId) })}>{t("workflow.edit")}</button>
            <button type="button" className={buttonClass} onClick={() => { setCancelError(null); setCancelUncertain(false); setCancelTarget(entry); }}>{t("entry.cancel")}</button>
          </div>
        ) : !entry.cancelledAt && dashboard.linkedCommanderIds.includes(entry.ashedMemberId) ? <p className="text-sm text-hq-fg-muted">{t("workflow.officerManaged")}</p> : null}
      </article>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("subtitle")}</p>
        <p className="text-xs text-hq-fg-muted">{t("workflow.serverTime")}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          {dashboard.linkedCommanderIds.length > 0 ? <button type="button" className={buttonClass} onClick={() => setModal({ officer: false })}>{t("form.title")}</button> : null}
          {dashboard.canManageOthers ? <button type="button" className={buttonClass} onClick={() => setModal({ officer: true })}>{t("form.officerEntry")}</button> : null}
        </div>
      </header>
      {dashboard.ashedSyncEnabled ? <TimeOffAshedRefreshButton canManage={dashboard.canManageOthers} onChanged={() => void refreshCurrent()} /> : null}
      {notice ? <p role="status" className="text-sm text-hq-fg">{notice}</p> : null}
      <div className="flex flex-wrap gap-2">
        {dashboard.linkedCommanderIds.length > 0 ? <button type="button" aria-pressed={tab === "my"} className={buttonClass} onClick={() => setTab("my")}>{t("workflow.myEntries")}</button> : null}
        <button type="button" aria-pressed={tab === "alliance"} className={buttonClass} onClick={() => setTab("alliance")}>{t("workflow.allianceCalendar")}</button>
        <button type="button" disabled={loading} className={buttonClass} onClick={() => void refreshCurrent()}>{loading ? t("workflow.loading") : t("unexpectedReport.refresh")}</button>
      </div>
      {error ? <p ref={errorRef} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      {tab === "my" ? (
        <section className="space-y-4" aria-label={t("workflow.myEntries")}>
          <div className="flex gap-2">
            <button type="button" aria-pressed={!dashboard.history} disabled={loading} className={buttonClass} onClick={() => void refresh(dashboard.monthKey, false, 0)}>{t("workflow.upcoming")}</button>
            <button type="button" aria-pressed={dashboard.history} disabled={loading} className={buttonClass} onClick={() => void refresh(dashboard.monthKey, true, 0)}>{t("workflow.history")}</button>
          </div>
          {dashboard.ownEntries.length ? <div className="grid gap-3 sm:grid-cols-2">{dashboard.ownEntries.map(entryCard)}</div> : <p className="text-sm text-hq-fg-muted">{t(dashboard.history ? "workflow.noHistory" : "workflow.noUpcoming")}</p>}
          <div className="flex justify-between gap-2">
            <button type="button" disabled={loading || dashboard.ownEntriesPage === 0} className={buttonClass} onClick={() => void refresh(dashboard.monthKey, dashboard.history, dashboard.ownEntriesPage - 1)}>{t("workflow.previous")}</button>
            <button type="button" disabled={loading || !dashboard.ownEntriesHaveMore} className={buttonClass} onClick={() => void refresh(dashboard.monthKey, dashboard.history, dashboard.ownEntriesPage + 1)}>{t("workflow.next")}</button>
          </div>
        </section>
      ) : (
        <section className="space-y-4" aria-label={t("workflow.allianceCalendar")}>
          <TimeOffCalendar entries={dashboard.entries} monthKey={dashboard.monthKey} todayServerDate={dashboard.todayServerDate}
            onMonthChange={(monthKey) => void refresh(monthKey, dashboard.history, dashboard.ownEntriesPage)} onSelectEntry={setSelectedEntry} />
          {selectedEntry ? entryCard(selectedEntry) : null}
          {dashboard.canManageOthers ? <UnexpectedAbsencePanel key={dashboard.monthKey + dashboard.unexpectedReport?.unexpected.map((entry) => entry.id + entry.version).join()} initialReport={dashboard.unexpectedReport} /> : null}
        </section>
      )}
      {modal ? <TimeOffEntryModal open entry={modal.entry} officerEntry={modal.officer} canManageOthers={dashboard.canManageOthers}
        commanders={modal.officer ? dashboard.commanders : dashboard.commanders.filter((member) => dashboard.linkedCommanderIds.includes(member.id))}
        today={dashboard.todayServerDate} onClose={() => { setModal(null); void refreshCurrent(); }} onSaved={() => {
          setNotice(t(modal.entry ? "workflow.updated" : "workflow.saved")); setModal(null); void refreshCurrent();
        }} /> : null}
      {cancelTarget ? <Dialog open title={t("entry.cancel")} onOpenChange={(next) => { if (!next && !saving) { setCancelTarget(null); void refreshCurrent(); } }}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void cancelEntry(); }}>
          <h2 className="font-semibold">{t("workflow.confirmCancel", { name: cancelTarget.memberName, start: formatDate(cancelTarget.startDate), end: formatDate(cancelTarget.endDate) })}</h2>
          <p className="text-sm text-hq-fg-muted">{t("workflow.cancelHint")}</p>
          {cancelError ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{cancelError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} className={buttonClass} onClick={() => { setCancelTarget(null); void refreshCurrent(); }}>{t("workflow.keepEntry")}</button>
            <button type="submit" disabled={saving || cancelUncertain} className={buttonClass}>{saving ? t("workflow.saving") : t("entry.cancel")}</button>
          </div>
        </form>
      </Dialog> : null}
    </div>
  );
}
