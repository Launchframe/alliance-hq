"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Dialog } from "@/components/ui/dialog";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import type { SerializedTimeOffEntry, TimeOffEntryKind } from "@/lib/time-off/types.shared";
import { TIME_OFF_MAX_NOTES, type TimeOffDraft } from "@/lib/time-off/workflow.shared";

const fieldClassName = "mt-1 w-full rounded border border-hq-border bg-hq-surface px-2 py-2 text-sm text-hq-fg";
const buttonClassName = "rounded border border-hq-border px-3 py-2 text-sm text-hq-fg disabled:opacity-50";

type Props = {
  open: boolean;
  commanders: Array<{ id: string; name: string }>;
  canManageOthers: boolean;
  officerEntry?: boolean;
  today: string;
  entry?: SerializedTimeOffEntry | null;
  onClose: () => void;
  onSaved: (entry: SerializedTimeOffEntry) => void;
};

export function TimeOffEntryModal({ open, commanders, canManageOthers, officerEntry, today, entry, onClose, onSaved }: Props) {
  const t = useTranslations("timeOff");
  const locale = useLocale();
  const [ashedMemberId, setMemberId] = useState(entry?.ashedMemberId ?? (commanders.length === 1 ? commanders[0].id : ""));
  const [startDate, setStartDate] = useState(entry?.startDate ?? "");
  const [endDate, setEndDate] = useState(entry?.endDate ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [entryKind, setEntryKind] = useState<TimeOffEntryKind>(entry?.entryKind ?? (officerEntry ? "officer_marked" : "planned"));
  const [preview, setPreview] = useState<(TimeOffDraft & { memberName: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const formatDate = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  async function submit() {
    if (submitting.current || uncertain) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    const isPreview = preview == null;
    try {
      requestId.current ??= crypto.randomUUID();
      const url = !isPreview && entry ? `/api/time-off/entries/${entry.id}` : "/api/time-off/entries";
      const response = await fetch(url, {
        method: !isPreview && entry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isPreview
          ? { ashedMemberId, startDate, endDate: endDate || startDate, notes, naturalLanguage, entryKind, preview: true }
          : { ...preview, version: entry?.version, requestId: requestId.current }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? t("workflow.errors.saveUnconfirmed"));
        if (!isPreview && (!data || response.status >= 500 || data.code === "staleEntry")) setUncertain(true);
        return;
      }
      if (isPreview && data?.draft) {
        setPreview(data.draft);
      } else if (!isPreview && data?.entry) {
        onSaved(data.entry);
      } else {
        setError(t("workflow.errors.saveUnconfirmed"));
        if (!isPreview) setUncertain(true);
      }
    } catch {
      setError(t(isPreview ? "workflow.errors.loadFailed" : "workflow.errors.saveUnconfirmed"));
      if (!isPreview) setUncertain(true);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const title = preview ? t("workflow.preview") : entry ? t("workflow.edit") : officerEntry ? t("officerModal.title") : t("form.title");
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }} title={title} className="max-w-lg">
      <h2 className="text-lg font-semibold text-hq-fg">{title}</h2>
      <p className="mt-2 text-sm text-hq-fg-muted">{t("workflow.serverTime")}</p>
      <form className="mt-4 space-y-4" onSubmit={(event) => { preventDefaultFormSubmit(event); void submit(); }}>
        {preview ? (
          <section className="space-y-2 rounded border border-hq-border bg-hq-surface-muted p-3">
            <p className="font-semibold">{preview.memberName}</p>
            <p>{t("entry.range", { start: formatDate(preview.startDate), end: formatDate(preview.endDate) })}</p>
            <p>{t(preview.entryKind === "unexpected" ? "workflow.unexpectedHint" : "workflow.globalAbsence")}</p>
            {preview.notes ? <p className="whitespace-pre-wrap break-words"><span className="font-medium">{t("workflow.privateNotes")}: </span>{preview.notes}</p> : null}
            <p className="text-sm text-hq-fg-muted">{t("workflow.previewHint")}</p>
            {preview.entryKind !== "unexpected" ? <p className="text-sm">{t("workflow.noticeCutoff")}</p> : null}
            {preview.entryKind !== "unexpected" && preview.startDate <= today && (!entry || entry.startDate !== preview.startDate || entry.endDate !== preview.endDate) ? (
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p>{t("workflow.lateNotice", { date: formatDate(preview.startDate) })}</p>
                <p>{t("workflow.futureExcusal")}</p>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <AppSelect aria-label={t("officerModal.member")} value={ashedMemberId} onChange={setMemberId}
              options={commanders.map((member) => ({ value: member.id, label: member.name, searchText: member.name }))}
              disabled={!!entry || saving} searchable combobox searchMode="fuzzy"
              placeholder={t("workflow.chooseCommander")} searchPlaceholder={t("workflow.searchCommander")} noSearchResultsLabel={t("workflow.noMatches")} />
            <label className="block text-sm">
              {t("form.hint")}
              <textarea value={naturalLanguage} onChange={(event) => setNaturalLanguage(event.target.value)} rows={2}
                maxLength={TIME_OFF_MAX_NOTES} placeholder={t("form.placeholder")} className={fieldClassName} disabled={saving} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">{t("officerModal.start")}
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={fieldClassName} disabled={saving} required={!naturalLanguage.trim()} />
              </label>
              <label className="block text-sm">{t("officerModal.end")}
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={fieldClassName} disabled={saving} />
              </label>
            </div>
            {canManageOthers && (officerEntry || entry?.entryKind !== "planned" && !!entry) ? (
              <label className="block text-sm">{t("officerModal.kind")}
                <select value={entryKind} onChange={(event) => setEntryKind(event.target.value as TimeOffEntryKind)} className={fieldClassName} disabled={saving}>
                  {entry?.entryKind === "planned" ? <option value="planned">{t("workflow.planned")}</option> : null}
                  <option value="officer_marked">{t("officerModal.kindPlanned")}</option>
                  <option value="unexpected">{t("workflow.unexpected")}</option>
                </select>
              </label>
            ) : null}
            <label className="block text-sm">{t("workflow.privateNotes")}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={TIME_OFF_MAX_NOTES} className={fieldClassName} disabled={saving} />
              <span className="mt-1 block text-xs text-hq-fg-muted">{t("workflow.notesHint")}</span>
            </label>
          </>
        )}
        {error ? <p ref={errorRef} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={buttonClassName}>{t("officerModal.cancel")}</button>
          {preview && !uncertain ? <button type="button" onClick={() => { setPreview(null); requestId.current = null; }} disabled={saving} className={buttonClassName}>{t("workflow.back")}</button> : null}
          <button type="submit" disabled={saving || uncertain} className="rounded bg-hq-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? t("workflow.saving") : !preview ? t("workflow.preview") : entry ? t("workflow.saveChanges") : t("form.submit")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
