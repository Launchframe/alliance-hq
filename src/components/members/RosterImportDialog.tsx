"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import type { AllianceMembersPayload } from "@/lib/members/load";
import type { CommanderIdentityConflict } from "@/lib/members/commander-identity-conflicts.shared";
import {
  detectBatchNameConflicts,
  normalizeCommanderName,
} from "@/lib/members/commander-identity-conflicts.shared";
import type { ParsedRosterRow } from "@/lib/members/roster-ocr/types";
import {
  buildMemberIndex,
  matchAllNames,
} from "@/lib/video/member-matcher";

type ReviewRow = {
  rowKey: string;
  extractedName: string;
  allianceRank: ParsedRosterRow["allianceRank"];
  allianceRankTitle?: string;
  layout: ParsedRosterRow["layout"];
  matchMemberId: string | null;
  heroPowerM: number | null;
  memberLevel: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: AllianceMembersPayload["members"];
  allianceTag: string;
  gameServerNumber?: number | null;
  onCommitted: () => void;
};

function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function rowsFromParse(
  parsed: ParsedRosterRow[],
  members: AllianceMembersPayload["members"],
  allianceTag: string,
): ReviewRow[] {
  const matches = matchAllNames(
    parsed.map((row) => row.extractedName),
    members,
    { allianceTag },
  );

  return parsed.map((row, index) => ({
    rowKey: newRowKey(),
    extractedName: row.extractedName,
    allianceRank: row.allianceRank,
    allianceRankTitle: row.allianceRankTitle,
    layout: row.layout,
    matchMemberId: matches[index]?.memberId ?? null,
    heroPowerM: row.heroPowerM ?? null,
    memberLevel: row.memberLevel ?? null,
  }));
}

export function RosterImportDialog({
  open,
  onOpenChange,
  members,
  allianceTag,
  gameServerNumber,
  onCommitted,
}: Props) {
  const t = useTranslations("members.import");
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [markAbsentInactive, setMarkAbsentInactive] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowConflicts, setRowConflicts] = useState<CommanderIdentityConflict[]>(
    [],
  );

  const memberIndex = useMemo(() => buildMemberIndex(members), [members]);

  const batchConflicts = useMemo(() => {
    if (gameServerNumber == null) return [];
    return detectBatchNameConflicts(
      rows.map((row, rowIndex) => ({
        extractedName: row.extractedName,
        matchMemberId: row.matchMemberId,
        rowIndex,
      })),
      gameServerNumber,
    );
  }, [gameServerNumber, rows]);

  const conflictRowIndexes = useMemo(() => {
    const indexes = new Set(
      batchConflicts.map((c) => c.rowIndex).filter((i) => i != null),
    );
    for (const conflict of rowConflicts) {
      if (conflict.rowIndex != null) indexes.add(conflict.rowIndex);
    }
    return indexes;
  }, [batchConflicts, rowConflicts]);

  const matchedCount = rows.filter((row) => row.matchMemberId).length;
  const newCount = rows.length - matchedCount;

  const reset = useCallback(() => {
    setStep("upload");
    setRows([]);
    setMarkAbsentInactive(false);
    setError(null);
    setRowConflicts([]);
    setParsing(false);
    setCommitting(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const parseFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setParsing(true);
      setError(null);

      try {
        const merged: ReviewRow[] = [];
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append("image", file);
          const res = await fetch("/api/members/roster-import/parse", {
            method: "POST",
            body: form,
          });
          const body = (await res.json()) as {
            rows?: ParsedRosterRow[];
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? t("parseFailed"));
          }
          merged.push(
            ...rowsFromParse(body.rows ?? [], members, allianceTag),
          );
        }

        if (merged.length === 0) {
          throw new Error(t("noRows"));
        }

        setRows(merged);
        setStep("review");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("parseFailed"));
      } finally {
        setParsing(false);
      }
    },
    [allianceTag, members, t],
  );

  const updateRow = useCallback(
    (rowKey: string, patch: Partial<ReviewRow>) => {
      setRows((prev) =>
        prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const removeRow = useCallback((rowKey: string) => {
    setRows((prev) => prev.filter((row) => row.rowKey !== rowKey));
  }, []);

  const commit = useCallback(async () => {
    if (rows.length === 0 || committing) return;
    setCommitting(true);
    setError(null);
    setRowConflicts([]);

    if (batchConflicts.length > 0) {
      setRowConflicts(batchConflicts);
      setError(t("nameConflictBlocked"));
      setCommitting(false);
      return;
    }

    try {
      const res = await fetch("/api/members/roster-import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map((row) => ({
            extractedName: row.extractedName,
            matchMemberId: row.matchMemberId,
            allianceRank: row.allianceRank,
            allianceRankTitle: row.allianceRankTitle ?? null,
            heroPowerM: row.heroPowerM,
            memberLevel: row.memberLevel,
          })),
          markAbsentInactive,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        conflicts?: CommanderIdentityConflict[];
      };
      if (res.status === 422 && body.code === "commander_identity_conflicts") {
        setRowConflicts(body.conflicts ?? []);
        throw new Error(t("nameConflictBlocked"));
      }
      if (!res.ok) {
        throw new Error(body.error ?? t("commitFailed"));
      }

      onCommitted();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("commitFailed"));
    } finally {
      setCommitting(false);
    }
  }, [
    batchConflicts,
    committing,
    handleOpenChange,
    markAbsentInactive,
    onCommitted,
    rows,
    t,
  ]);

  const activeMemberOptions = memberIndex.active;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("title")}
      className="max-w-[min(96vw,56rem)]"
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("title")}</h2>

        {step === "upload" ? (
          <div className="space-y-4">
            <p className="text-sm text-hq-fg-muted">{t("uploadHint")}</p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hq-border bg-hq-canvas px-6 py-10 text-sm text-hq-fg-muted hover:border-hq-accent">
              <span>{parsing ? t("parsing") : t("uploadPrompt")}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                disabled={parsing}
                onChange={(e) => void parseFiles(e.target.files)}
              />
            </label>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void commit();
            }}
          >
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-[#23863633] px-2.5 py-1 text-hq-green">
                {t("matchedBadge", { count: matchedCount })}
              </span>
              <span className="rounded-full bg-[#388bfd33] px-2.5 py-1 text-hq-accent">
                {t("newBadge", { count: newCount })}
              </span>
              <span className="rounded-full bg-hq-border px-2.5 py-1 text-hq-fg-muted">
                {t("totalBadge", { count: rows.length })}
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-hq-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-hq-canvas text-xs text-hq-fg-muted">
                  <tr>
                    <th className="px-3 py-2">{t("colName")}</th>
                    <th className="px-3 py-2">{t("colMatch")}</th>
                    <th className="px-3 py-2">{t("colPower")}</th>
                    <th className="px-3 py-2">{t("colLevel")}</th>
                    <th className="px-3 py-2">{t("colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const hasConflict = conflictRowIndexes.has(index);
                    return (
                    <tr
                      key={row.rowKey}
                      className={`border-t border-hq-border ${
                        hasConflict ? "bg-[#f8514911]" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          className="w-full min-w-[8rem] rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.extractedName}
                          onChange={(e) =>
                            updateRow(row.rowKey, {
                              extractedName: e.target.value,
                            })
                          }
                        />
                        {hasConflict ? (
                          <p className="mt-1 text-xs text-hq-danger">
                            {t("nameConflictHint", {
                              name: normalizeCommanderName(row.extractedName),
                            })}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="w-full min-w-[10rem] rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.matchMemberId ?? ""}
                          onChange={(e) =>
                            updateRow(row.rowKey, {
                              matchMemberId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">{t("createNew")}</option>
                          {activeMemberOptions.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.current_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.1"
                          className="w-24 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.heroPowerM ?? ""}
                          onChange={(e) =>
                            updateRow(row.rowKey, {
                              heroPowerM: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-20 rounded border border-hq-border bg-hq-canvas px-2 py-1"
                          value={row.memberLevel ?? ""}
                          onChange={(e) =>
                            updateRow(row.rowKey, {
                              memberLevel: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-hq-danger hover:underline"
                          onClick={() => removeRow(row.rowKey)}
                        >
                          {t("removeRow")}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="flex items-start gap-2 text-sm text-hq-fg-muted">
              <input
                type="checkbox"
                checked={markAbsentInactive}
                onChange={(e) => setMarkAbsentInactive(e.target.checked)}
                className="mt-1 size-4 rounded border-[#484f58] accent-[#388bfd]"
              />
              <span>
                <span className="block text-hq-fg">{t("inactiveSweep")}</span>
                <span className="text-xs">{t("inactiveSweepHelp")}</span>
              </span>
            </label>

            {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-lg border border-hq-border px-4 py-2 text-sm"
                onClick={() => setStep("upload")}
                disabled={committing}
              >
                {t("back")}
              </button>
              <button
                type="submit"
                className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={committing || rows.length === 0 || batchConflicts.length > 0}
              >
                {committing ? t("committing") : t("commit")}
              </button>
            </div>
          </form>
        )}

        {step === "upload" && error ? <p className="text-sm text-hq-danger">{error}</p> : null}

        {step === "upload" ? (
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-hq-border px-4 py-2 text-sm"
              onClick={() => handleOpenChange(false)}
              disabled={parsing}
            >
              {t("cancel")}
            </button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
