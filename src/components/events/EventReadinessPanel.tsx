"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  EventBoardDto,
  EventEvidenceBatchDto,
  EventResultRow,
} from "@/lib/hq-events/workspace.shared";
import {
  batchSourceKindLabelKey,
  resultFilterOf,
} from "@/lib/hq-events/workspace.shared";

type Props = {
  board: EventBoardDto;
  batches: EventEvidenceBatchDto[];
  results: EventResultRow[];
  /** `trains:write` only — otherwise render read-only state. */
  canMarkReady: boolean;
  onChanged: () => void;
};

/**
 * Per-board readiness controls: include/omit evidence sources, confirm an
 * empty leaderboard, and mark the board ready for train draws behind an
 * evidence-version fence (409 => caller reloads).
 */
export function EventReadinessPanel({
  board,
  batches,
  results,
  canMarkReady,
  onChanged,
}: Props) {
  const t = useTranslations("eventEvidence");
  const tActions = useTranslations("vsPerformance.actions");

  const boardBatches = useMemo(
    () =>
      batches.filter(
        (batch) => batch.boardId == null || batch.boardId === board.id,
      ),
    [batches, board.id],
  );

  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        board.readySources ?? boardBatches.map((batch) => batch.id),
      ),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [emptyConfirmed, setEmptyConfirmed] = useState(
    board.emptyConfirmed === 1,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasScored = results.some(
    (row) => resultFilterOf(row) === "scored",
  );
  const incompleteImport = boardBatches.some(
    (batch) => batch.importStatus === "incomplete",
  );
  const staged = boardBatches.some(
    (batch) =>
      batch.sourceKind === "ashed_import" &&
      batch.legacyMappingConfirmed === 0,
  );
  const conflicts = results.some(
    (row) => resultFilterOf(row) === "conflict",
  );
  const blocked = incompleteImport || staged || conflicts;
  const needsEmptyConfirm = !hasScored && !emptyConfirmed;

  const markReady = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hq-events/${board.hqEventId}/readiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId: board.id,
          action: "mark",
          expectedEvidenceVersion: board.evidenceVersion,
          readySources: [...selected],
          emptyConfirmed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        setError(t("readinessInvalidated"));
        onChanged();
        return;
      }
      if (!res.ok) {
        setError(
          body?.error === "empty_confirmation_required" ||
            body?.error === "import_incomplete"
            ? t("pendingEvidence")
            : t("actionFailed"),
        );
        return;
      }
      onChanged();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setPending(false);
    }
  };

  const toggleSource = (batchId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  return (
    <section className="space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-hq-fg">
          {t("readyForDraws")}
        </h3>
        {board.ready ? (
          <span className="rounded-full bg-hq-accent/10 px-2 py-0.5 text-xs font-medium text-hq-accent">
            {t("readyForDraws")}
          </span>
        ) : null}
      </div>
      {boardBatches.length > 0 && canMarkReady ? (
        <ul className="space-y-1.5">
          {boardBatches.map((batch) => (
            <li
              key={batch.id}
              className="flex items-center gap-2 text-sm text-hq-fg"
            >
              <Checkbox
                checked={selected.has(batch.id)}
                onCheckedChange={() => toggleSource(batch.id)}
                aria-label={t(batchSourceKindLabelKey(batch.sourceKind))}
              />
              <span className="text-xs">
                {t(batchSourceKindLabelKey(batch.sourceKind))}
              </span>
              {!selected.has(batch.id) ? (
                <span className="text-xs text-hq-fg-muted">
                  {t("sourceOmitted")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canMarkReady && !hasScored ? (
        <label className="flex items-start gap-2 text-xs text-hq-fg">
          <Checkbox
            checked={emptyConfirmed}
            onCheckedChange={(value) => setEmptyConfirmed(value === true)}
          />
          <span>{t("confirmEmptyLeaderboard")}</span>
        </label>
      ) : null}
      {canMarkReady ? (
        <label className="flex items-start gap-2 text-xs text-hq-fg">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(value === true)}
          />
          <span>{t("readyConfirmation")}</span>
        </label>
      ) : null}
      {blocked ? (
        <p className="text-xs text-hq-warning">{t("pendingEvidence")}</p>
      ) : null}
      {incompleteImport ? (
        <p className="text-xs text-hq-warning">{t("importIncomplete")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-hq-danger">
          {error}
        </p>
      ) : null}
      {canMarkReady && !board.ready ? (
        <Button
          type="button"
          size="sm"
          disabled={
            pending || blocked || !confirmed || needsEmptyConfirm
          }
          onClick={() => void markReady()}
        >
          {pending ? tActions("save") : t("readyForDraws")}
        </Button>
      ) : null}
    </section>
  );
}
