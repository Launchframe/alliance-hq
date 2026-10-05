"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useDirtyGuard } from "@/components/navigation/DirtyNavigation";
import {
  buildScoreChanges,
  scoreCellKey,
  validateScoreDraft,
  weeklyScoreMismatch,
  type VsScoreDraft,
  type VsScoreDraftEdit,
} from "@/lib/vs-performance/score-editor.shared";
import type { VsMemberDetailResponse } from "@/lib/vs-performance/member-performance-view.shared";

type Edit = NonNullable<VsMemberDetailResponse["edit"]>;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const inputClass = "w-full rounded border border-hq-border bg-hq-canvas px-2 py-1 text-sm tabular-nums disabled:opacity-60";

type SavePhase = "editing" | "saving" | "uncertain" | "saved";
type SaveError = "invalid" | "period" | "changed" | "forbidden" | "notFound" | "save" | null;

export function VsMemberScoreEditor({
  memberId,
  weekStart,
  edit,
  onSaved,
}: {
  memberId: string;
  weekStart: string;
  edit: Edit;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("vsPerformance.member");
  const tMembers = useTranslations("vsPerformance.members");
  const tActions = useTranslations("vsPerformance.actions");
  const tErrors = useTranslations("vsPerformance.errors");
  const tWeekdays = useTranslations("trains.weekdays");
  const tSync = useTranslations("timeOff.sync");
  const all = useTranslations();

  const [draft, setDraft] = useState<VsScoreDraft>(() => new Map());
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<SavePhase>("editing");
  const [error, setError] = useState<SaveError>(null);
  const [changedEvidence, setChangedEvidence] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const attempt = useRef<{ requestId: string; body: string } | null>(null);
  const saving = useRef(false);
  const [seenFingerprint, setSeenFingerprint] = useState(edit.evidenceFingerprint);

  if (edit.evidenceFingerprint !== seenFingerprint) {
    setSeenFingerprint(edit.evidenceFingerprint);
    if (draft.size > 0) setChangedEvidence(true);
    if (phase !== "editing" && phase !== "saved") setPhase("editing");
  }

  const dirty = draft.size > 0 || reason.trim().length > 0;
  useDirtyGuard(
    useCallback(
      () => ({ dirty, keys: ["pathname", "week"], discard: () => { setDraft(new Map()); setReason(""); } }),
      [dirty],
    ),
  );

  const setCell = (cell: Edit["cells"][number], value: VsScoreDraftEdit | null) => {
    if (phase === "uncertain" || phase === "saving") return;
    setPhase("editing");
    setError(null);
    setDraft((current) => {
      const next = new Map(current);
      if (value === null) next.delete(scoreCellKey(cell));
      else next.set(scoreCellKey(cell), value);
      return next;
    });
  };

  const changes = useMemo(() => buildScoreChanges(draft, edit.cells), [draft, edit.cells]);
  const mismatch = useMemo(() => weeklyScoreMismatch(edit.cells, draft), [edit.cells, draft]);
  const reasonTooLong = reason.length > 2000;

  const submit = useCallback(
    async (requestId: string, body: string) => {
      saving.current = true;
      setPhase("saving");
      setError(null);
      let result: { ok?: boolean; syncStatus?: string } | null = null;
      let status = 0;
      try {
        const response = await fetch(`/api/vs-performance/members/${encodeURIComponent(memberId)}/scores`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
          cache: "no-store",
        });
        status = response.status;
        result = await response.json().catch(() => null);
      } catch {
        setPhase("uncertain");
        saving.current = false;
        return;
      }
      saving.current = false;
      if (status === 200 && result?.ok) {
        setPhase("saved");
        setSyncStatus(result.syncStatus ?? null);
        setDraft(new Map());
        setReason("");
        attempt.current = null;
        await onSaved();
        return;
      }
      if (status === 409) {
        setPhase("editing");
        setError("changed");
        return;
      }
      if (status === 400) {
        const code = result && typeof result === "object" && "code" in result ? String(result.code) : "";
        setPhase("editing");
        setError(code === "invalid_period" ? "period" : "invalid");
        return;
      }
      if (status === 403) {
        setPhase("editing");
        setError("forbidden");
        return;
      }
      if (status === 404) {
        setPhase("editing");
        setError("notFound");
        return;
      }
      setPhase("uncertain");
    },
    [memberId, onSaved],
  );

  const save = useCallback(() => {
    if (saving.current || changes.length === 0 || reasonTooLong || !validateScoreDraft(draft)) {
      if (changes.length && !validateScoreDraft(draft)) setError("invalid");
      return;
    }
    const requestId = crypto.randomUUID();
    const body = JSON.stringify({
      weekStart,
      scope: edit.scope,
      inputVersion: edit.inputVersion,
      evidenceFingerprint: edit.evidenceFingerprint,
      requestId,
      changes,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    attempt.current = { requestId, body };
    void submit(requestId, body);
  }, [changes, draft, edit, reason, reasonTooLong, submit, weekStart]);

  const retry = useCallback(() => {
    if (!attempt.current || saving.current) return;
    void submit(attempt.current.requestId, attempt.current.body);
  }, [submit]);

  const sourceLabel = (source: Edit["cells"][number]["source"]) =>
    source === "hq" ? all("vsPerformance.results.sourceHq") : source === "ashed" ? all("vsPerformance.results.sourceAshed") : source === "derived" ? tMembers("derived") : null;

  const locked = phase === "saving" || phase === "uncertain";

  return (
    <div className="space-y-3 rounded-lg border border-hq-border p-3" data-testid="vs-member-score-editor">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-hq-fg">{t("editScores")}</h3>
        <p className="text-xs text-hq-fg-muted">{t("editorHint")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {edit.cells.map((cell, index) => {
          const key = scoreCellKey(cell);
          const editValue = draft.get(key);
          const label =
            cell.period === "weekly"
              ? tMembers("reportedTotal")
              : t("dayScore", { day: tWeekdays(DAY_KEYS[index] ?? "mon") });
          const clearLabel =
            cell.period === "weekly"
              ? t("clearWeeklyScore")
              : t("clearDayScore", { day: tWeekdays(DAY_KEYS[index] ?? "mon") });
          const displayed = editValue?.operation === "set" ? editValue.value : (cell.score ?? "");
          return (
            <div key={key} className="space-y-1">
              <label htmlFor={`vs-score-${key}`} className="flex items-center justify-between gap-2 text-xs text-hq-fg-muted">
                <span>{label}</span>
                {sourceLabel(cell.source) ? <span>{sourceLabel(cell.source)}</span> : null}
              </label>
              {cell.editable ? (
                <>
                  <input
                    id={`vs-score-${key}`}
                    data-testid={`vs-score-input-${key}`}
                    className={inputClass}
                    inputMode="numeric"
                    disabled={locked}
                    value={editValue?.operation === "clear" ? "" : displayed}
                    onChange={(event) =>
                      setCell(
                        cell,
                        event.target.value === "" || event.target.value === (cell.score ?? "")
                          ? null
                          : { operation: "set", value: event.target.value },
                      )
                    }
                  />
                  {editValue?.operation === "clear" ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-hq-danger">{t("pendingClear")}</p>
                      <button type="button" className="text-xs text-hq-accent hover:underline" onClick={() => setCell(cell, null)}>
                        {t("undoClear")}
                      </button>
                    </div>
                  ) : null}
                  {cell.canClear && editValue?.operation !== "clear" ? (
                    <button
                      type="button"
                      disabled={locked}
                      className="text-xs text-hq-accent hover:underline disabled:opacity-50"
                      onClick={() => setCell(cell, { operation: "clear" })}
                    >
                      {clearLabel}
                    </button>
                  ) : null}
                </>
              ) : (
                <div>
                  <input
                    id={`vs-score-${key}`}
                    data-testid={`vs-score-input-${key}`}
                    className={inputClass}
                    disabled
                    value={cell.score ?? ""}
                    readOnly
                  />
                  <p className="text-xs text-hq-fg-muted">{t("futureDay")}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-hq-fg-muted">{t("clearHint")}</p>
      <div className="space-y-1">
        <label htmlFor="vs-score-reason" className="text-xs text-hq-fg-muted">
          {t("correctionReason")}
        </label>
        <textarea
          id="vs-score-reason"
          data-testid="vs-score-reason"
          className="w-full rounded border border-hq-border bg-hq-canvas px-2 py-1 text-sm"
          rows={2}
          maxLength={2000}
          disabled={locked}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (phase === "editing") setError(null);
          }}
        />
        <p className="text-xs text-hq-fg-muted">{t("reasonPrivate")}</p>
        {reasonTooLong ? <p className="text-xs text-hq-danger">{t("reasonTooLong")}</p> : null}
      </div>
      {mismatch ? <p className="text-sm text-hq-warning" role="status">{t("scoreConflict")}</p> : null}
      {error === "invalid" ? <p role="alert" className="text-sm text-hq-danger">{t("scoreInvalid")}</p> : null}
      {error === "period" ? <p role="alert" className="text-sm text-hq-danger">{t("futureDay")}</p> : null}
      {error === "changed" ? <p role="alert" className="text-sm text-hq-danger">{t("scoreChanged")}</p> : null}
      {error === "forbidden" ? <p role="alert" className="text-sm text-hq-danger">{tErrors("forbidden")}</p> : null}
      {error === "notFound" ? <p role="alert" className="text-sm text-hq-danger">{t("notFound")}</p> : null}
      {error === "save" ? <p role="alert" className="text-sm text-hq-danger">{tErrors("save")}</p> : null}
      {phase === "uncertain" ? <p role="alert" className="text-sm text-hq-danger">{t("saveUnconfirmed")}</p> : null}
      {phase === "saved" ? (
        <p role="status" className="text-sm text-hq-success">
          <span>{t("saved")}</span>
          {syncStatus ? <span>{` · ${tSync(syncStatus === "local" ? "localOnly" : syncStatus === "credentials_required" ? "credentialsRequired" : syncStatus)}`}</span> : null}
        </p>
      ) : null}
      {changedEvidence && draft.size > 0 ? <p className="text-xs text-hq-fg-muted">{t("scoreChanged")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {phase === "uncertain" ? (
          <Button type="button" size="sm" onClick={retry}>
            {tActions("retry")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={locked || changes.length === 0 || reasonTooLong}
            onClick={save}
          >
            {phase === "saving" ? tActions("saving") : tActions("save")}
          </Button>
        )}
        {changes.length === 0 && draft.size === 0 ? <p className="self-center text-xs text-hq-fg-muted">{t("noChanges")}</p> : null}
        {error === "changed" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void onSaved()}>
            {t("reviewLatest")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
