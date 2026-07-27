"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Dialog } from "@/components/ui/dialog";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import {
  classifyHistoryImportRow,
  historyImportRowIsCommitable,
  insertBlankLinesBefore,
  interpolateHistoryDates,
  parseHistoryPaste,
  type ExistingConductorSnapshot,
  type HistoryImportRowCommitStatus,
  type InterpolatedHistoryRow,
  type ParsedHistoryLine,
} from "@/lib/trains/conductor-history-import.shared";
import { memberMatchConfidenceBorderClass } from "@/lib/video/member-match-confidence-class";
import {
  matchAllNames,
  type AshedMember,
} from "@/lib/video/member-matcher";
import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";

type RosterMember = {
  memberId: string;
  memberName: string;
};

type ReviewRow = InterpolatedHistoryRow & {
  rowKey: string;
  memberId: string | null;
  memberName: string | null;
  confidence: number;
  status: HistoryImportRowCommitStatus;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  roster: RosterMember[];
  onImported: () => void;
};

function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toAshedMembers(roster: RosterMember[]): AshedMember[] {
  return roster.map((member) => ({
    id: member.memberId,
    current_name: member.memberName,
    status: "active",
  }));
}

function historyImportStatusBadgeClass(
  status: HistoryImportRowCommitStatus,
): string {
  switch (status) {
    case "ready":
      return "border-hq-success/40 bg-hq-success/15 text-hq-success";
    case "overwrite_draft":
      return "border-hq-accent/40 bg-hq-accent/15 text-hq-accent";
    case "already_locked":
      return "border-hq-border bg-hq-canvas text-hq-fg-muted";
    case "blank":
      return "border-hq-border bg-hq-surface-muted text-hq-fg-muted";
    case "unmatched":
    case "date_conflict":
    case "gap":
    case "missing_date":
    case "not_descending":
      return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200";
    case "conflict_locked":
    case "not_past":
      return "border-hq-danger/40 bg-hq-danger/15 text-hq-danger";
    default:
      return "border-hq-border bg-hq-canvas text-hq-fg-muted";
  }
}

export function ConductorHistoryImportDialog({
  open,
  onOpenChange,
  today,
  roster,
  onImported,
}: Props) {
  const t = useTranslations("trains.historyImport");
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [pasteText, setPasteText] = useState("");
  const [firstDate, setFirstDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [lines, setLines] = useState<ParsedHistoryLine[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [existingByDate, setExistingByDate] = useState<
    Map<string, ExistingConductorSnapshot>
  >(new Map());
  const [hasGap, setHasGap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);

  const ashedMembers = useMemo(() => toAshedMembers(roster), [roster]);
  const defaultYear = Number.parseInt(today.slice(0, 4), 10) || 2026;

  const reset = useCallback(() => {
    setStep("paste");
    setPasteText("");
    setFirstDate("");
    setLastDate("");
    setLines([]);
    setRows([]);
    setExistingByDate(new Map());
    setHasGap(false);
    setError(null);
    setBusy(false);
    setCommitting(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const statusLabel = useCallback(
    (row: ReviewRow) => {
      switch (row.status) {
        case "ready":
          return t("status.ok");
        case "already_locked":
          return t("status.alreadyLocked");
        case "conflict_locked":
          return t("status.conflictLocked");
        case "unmatched":
          return t("status.unmatched");
        case "overwrite_draft":
          return t("status.overwriteDraft");
        case "not_past":
          return t("status.notPast");
        case "blank":
          return t("status.blank");
        case "date_conflict":
          if (row.anchorConflict) {
            return t("status.dateConflict", {
              date: row.anchorConflict.labeledDate,
            });
          }
          return t("status.gap");
        case "gap":
        case "missing_date":
        case "not_descending":
          return t("status.gap");
        default:
          return row.status;
      }
    },
    [t],
  );

  const classifyAgainstExisting = useCallback(
    (
      row: InterpolatedHistoryRow,
      memberId: string | null,
      existingMap: Map<string, ExistingConductorSnapshot>,
    ): HistoryImportRowCommitStatus =>
      classifyHistoryImportRow({
        date: row.date,
        flags: row.flags,
        memberId,
        blank: row.blank,
        existing: row.date ? existingMap.get(row.date) : undefined,
      }),
    [],
  );

  const buildReviewFromLines = useCallback(
    async (nextLines: ParsedHistoryLine[]) => {
      const { rows: interpolated, hasGap: gap } = interpolateHistoryDates({
        lines: nextLines,
        today,
        defaultYear,
        firstDate: firstDate.trim() || null,
        lastDate: lastDate.trim() || null,
      });
      setHasGap(gap);

      const dated = interpolated
        .map((row) => row.date)
        .filter((date): date is string => Boolean(date));
      const nextExisting = new Map<string, ExistingConductorSnapshot>();
      if (dated.length > 0) {
        const start = dated.reduce((a, b) => (a < b ? a : b));
        const end = dated.reduce((a, b) => (a > b ? a : b));
        const res = await fetch(
          `/api/trains/conductor/history-import?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        );
        const body = (await res.json()) as {
          records?: ExistingConductorSnapshot[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.error ?? t("lookupFailed"));
        }
        for (const record of body.records ?? []) {
          nextExisting.set(record.date, record);
        }
      }
      setExistingByDate(nextExisting);

      const matches = matchAllNames(
        interpolated.map((row) => row.name),
        ashedMembers,
      );

      setLines(nextLines);
      setRows(
        interpolated.map((row, index) => {
          const match = row.blank ? null : matches[index];
          const memberId = match?.memberId ?? null;
          return {
            ...row,
            rowKey: newRowKey(),
            memberId,
            memberName: match?.memberName ?? null,
            confidence: match?.confidence ?? 0,
            status: classifyAgainstExisting(row, memberId, nextExisting),
          };
        }),
      );
    },
    [
      ashedMembers,
      classifyAgainstExisting,
      defaultYear,
      firstDate,
      lastDate,
      t,
      today,
    ],
  );

  const goToReview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseHistoryPaste(pasteText);
      if (parsed.length === 0) {
        throw new Error(t("pasteEmpty"));
      }
      await buildReviewFromLines(parsed);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("lookupFailed"));
    } finally {
      setBusy(false);
    }
  }, [buildReviewFromLines, pasteText, t]);

  const insertBlanksBeforeRow = useCallback(
    async (rowIndex: number, count: number) => {
      if (count <= 0) return;
      setBusy(true);
      setError(null);
      try {
        await buildReviewFromLines(
          insertBlankLinesBefore(lines, rowIndex, count),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : t("lookupFailed"));
      } finally {
        setBusy(false);
      }
    },
    [buildReviewFromLines, lines, t],
  );

  const setRowMember = useCallback(
    (rowKey: string, memberId: string) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.rowKey !== rowKey || row.blank) return row;
          if (!memberId) {
            return {
              ...row,
              memberId: null,
              memberName: null,
              confidence: 0,
              status: classifyAgainstExisting(row, null, existingByDate),
            };
          }
          const member = ashedMembers.find((m) => m.id === memberId);
          return {
            ...row,
            memberId,
            memberName: member?.current_name ?? row.memberName,
            confidence: 1,
            status: classifyAgainstExisting(row, memberId, existingByDate),
          };
        }),
      );
    },
    [ashedMembers, classifyAgainstExisting, existingByDate],
  );

  const commitableRows = rows.filter((row) =>
    historyImportRowIsCommitable(row.status),
  );

  const commit = useCallback(async () => {
    if (commitableRows.length === 0 || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/history-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: commitableRows.map((row) => ({
            date: row.date,
            memberId: row.memberId,
            memberName: row.memberName,
          })),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? t("commitFailed"));
      }
      onImported();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("commitFailed"));
    } finally {
      setCommitting(false);
    }
  }, [commitableRows, committing, handleOpenChange, onImported, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("title")}
      className="max-w-[min(96vw,56rem)]"
    >
      <div className="space-y-4">
        {step === "paste" ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void goToReview();
            }}
          >
            <p className="text-sm text-hq-fg-muted">{t("pasteHint")}</p>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-hq-fg">{t("pasteLabel")}</span>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={12}
                className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
                data-testid="trains-history-import-paste"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-hq-fg">{t("firstDate")}</span>
                <input
                  type="date"
                  value={firstDate}
                  onChange={(e) => setFirstDate(e.target.value)}
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-hq-fg">{t("lastDate")}</span>
                <input
                  type="date"
                  value={lastDate}
                  onChange={(e) => setLastDate(e.target.value)}
                  className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
                />
              </label>
            </div>
            {error ? (
              <p className="text-sm text-hq-danger" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:bg-hq-canvas"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={busy || !pasteText.trim()}
                className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
                data-testid="trains-history-import-review"
              >
                {busy ? t("reviewing") : t("reviewTitle")}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void commit();
            }}
          >
            {hasGap ? (
              <p
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-hq-fg"
                role="status"
              >
                {t("gapBanner")}
              </p>
            ) : null}
            <div className="overflow-hidden rounded-lg border border-hq-border">
              <div className="hidden grid-cols-[7.5rem_minmax(7rem,1fr)_minmax(10rem,1.4fr)_minmax(8rem,1fr)_auto] gap-3 bg-hq-canvas px-3 py-2 text-xs uppercase tracking-wide text-hq-fg-muted md:grid">
                <span className="font-medium">{t("colDate")}</span>
                <span className="font-medium">{t("colPastedName")}</span>
                <span className="font-medium">{t("colMember")}</span>
                <span className="font-medium">{t("colStatus")}</span>
                <span className="font-medium">{t("colActions")}</span>
              </div>
              <ul className="divide-y divide-hq-border">
                {rows.map((row) => {
                  const options = buildMemberMatchSelectOptions(ashedMembers, {
                    emptyLabel: t("status.unmatched"),
                    highlightMemberId: row.memberId,
                    highlightConfidence: row.confidence,
                  });
                  const insertCount = row.anchorConflict?.missingDayCount ?? 0;
                  const highlight =
                    row.status === "date_conflict" ||
                    row.status === "gap" ||
                    row.status === "blank";
                  return (
                    <li
                      key={row.rowKey}
                      className={`grid gap-3 px-3 py-3 md:grid-cols-[7.5rem_minmax(7rem,1fr)_minmax(10rem,1.4fr)_minmax(8rem,1fr)_auto] md:items-center ${
                        highlight ? "bg-amber-500/10" : ""
                      }`}
                      data-testid={`trains-history-import-row-${row.index}`}
                      data-status={row.status}
                    >
                      <div className="space-y-1 md:space-y-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-hq-fg-muted md:hidden">
                          {t("colDate")}
                        </p>
                        <p className="whitespace-nowrap tabular-nums text-hq-fg">
                          {row.date ?? "—"}
                        </p>
                      </div>
                      <div className="space-y-1 md:space-y-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-hq-fg-muted md:hidden">
                          {t("colPastedName")}
                        </p>
                        <p className="font-medium text-hq-fg">
                          {row.blank ? t("blankName") : row.name}
                        </p>
                      </div>
                      <div className="space-y-1 md:space-y-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-hq-fg-muted md:hidden">
                          {t("colMember")}
                        </p>
                        {row.blank ? (
                          <span className="text-hq-fg-muted">—</span>
                        ) : (
                          <AppSelect
                            value={row.memberId ?? ""}
                            onChange={(value) =>
                              setRowMember(row.rowKey, value)
                            }
                            options={options}
                            searchable
                            searchMode="fuzzy"
                            triggerClassName={memberMatchConfidenceBorderClass(
                              row.memberId ? row.confidence : 0,
                            )}
                          />
                        )}
                      </div>
                      <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-hq-border pt-3 md:contents md:border-0 md:pt-0">
                        <div className="space-y-1 md:space-y-0">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-hq-fg-muted md:hidden">
                            {t("colStatus")}
                          </p>
                          <span
                            className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-snug ${historyImportStatusBadgeClass(row.status)}`}
                          >
                            {statusLabel(row)}
                          </span>
                        </div>
                        <div>
                          {row.status === "date_conflict" && insertCount > 0 ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void insertBlanksBeforeRow(
                                  row.index,
                                  insertCount,
                                )
                              }
                              className="rounded-md border border-hq-border px-2 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                              data-testid={`trains-history-import-insert-blanks-${row.index}`}
                            >
                              {t("fillGap")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            {error ? (
              <p className="text-sm text-hq-danger" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep("paste")}
                className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:bg-hq-canvas"
              >
                {t("back")}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:bg-hq-canvas"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={
                    committing ||
                    commitableRows.length === 0 ||
                    hasGap ||
                    busy
                  }
                  className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
                  data-testid="trains-history-import-commit"
                >
                  {committing
                    ? t("committing")
                    : t("commitPartial", { count: commitableRows.length })}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
