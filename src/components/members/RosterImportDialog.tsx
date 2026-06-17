"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import type { AllianceMembersPayload } from "@/lib/members/load";
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
  onCommitted,
}: Props) {
  const t = useTranslations("members.import");
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [markAbsentInactive, setMarkAbsentInactive] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberIndex = useMemo(() => buildMemberIndex(members), [members]);

  const matchedCount = rows.filter((row) => row.matchMemberId).length;
  const newCount = rows.length - matchedCount;

  const reset = useCallback(() => {
    setStep("upload");
    setRows([]);
    setMarkAbsentInactive(false);
    setError(null);
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
      const body = (await res.json()) as { error?: string };
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
  }, [committing, handleOpenChange, markAbsentInactive, onCommitted, rows, t]);

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
            <p className="text-sm text-[#8b949e]">{t("uploadHint")}</p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#30363d] bg-[#0d1117] px-6 py-10 text-sm text-[#8b949e] hover:border-[#58a6ff]">
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
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-[#23863633] px-2.5 py-1 text-[#3fb950]">
                {t("matchedBadge", { count: matchedCount })}
              </span>
              <span className="rounded-full bg-[#388bfd33] px-2.5 py-1 text-[#58a6ff]">
                {t("newBadge", { count: newCount })}
              </span>
              <span className="rounded-full bg-[#30363d] px-2.5 py-1 text-[#8b949e]">
                {t("totalBadge", { count: rows.length })}
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#30363d]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#0d1117] text-xs text-[#8b949e]">
                  <tr>
                    <th className="px-3 py-2">{t("colName")}</th>
                    <th className="px-3 py-2">{t("colMatch")}</th>
                    <th className="px-3 py-2">{t("colPower")}</th>
                    <th className="px-3 py-2">{t("colLevel")}</th>
                    <th className="px-3 py-2">{t("colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowKey} className="border-t border-[#30363d]">
                      <td className="px-3 py-2">{row.extractedName}</td>
                      <td className="px-3 py-2">
                        <select
                          className="w-full min-w-[10rem] rounded border border-[#30363d] bg-[#0d1117] px-2 py-1"
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
                          className="w-24 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1"
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
                          className="w-20 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1"
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
                          className="text-xs text-[#f85149] hover:underline"
                          onClick={() => removeRow(row.rowKey)}
                        >
                          {t("removeRow")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="flex items-start gap-2 text-sm text-[#8b949e]">
              <input
                type="checkbox"
                checked={markAbsentInactive}
                onChange={(e) => setMarkAbsentInactive(e.target.checked)}
                className="mt-1 size-4 rounded border-[#484f58] accent-[#388bfd]"
              />
              <span>
                <span className="block text-[#e6edf3]">{t("inactiveSweep")}</span>
                <span className="text-xs">{t("inactiveSweepHelp")}</span>
              </span>
            </label>
          </div>
        )}

        {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {step === "review" ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-[#30363d] px-4 py-2 text-sm"
                onClick={() => setStep("upload")}
                disabled={committing}
              >
                {t("back")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => void commit()}
                disabled={committing || rows.length === 0}
              >
                {committing ? t("committing") : t("commit")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm"
              onClick={() => handleOpenChange(false)}
              disabled={parsing}
            >
              {t("cancel")}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
