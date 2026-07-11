"use client";

import { Video } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import {
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositStatus,
  type DepositTermDays,
} from "@/lib/banks/types.shared";

export type DepositSlipVideoReviewRow = {
  id: string;
  ocrName: string;
  score: string | null;
  powerLevel: string | null;
  memberLevel: number | null;
  profession: string | null;
  allianceRankTitle: string | null;
  rosterRankRaw: string | null;
  frameIndex?: number | null;
  deleted: number;
};

type Props = {
  rows: DepositSlipVideoReviewRow[];
  filterQuery: string;
  onUpdateRow: (id: string, patch: Partial<DepositSlipVideoReviewRow>) => void;
  onDeleteRow: (id: string) => void;
  onPreviewFrame?: (frameIndex: number | null | undefined) => void;
  rowCanVideoPreview?: (frameIndex: number | null | undefined) => boolean;
};

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function datetimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Treat datetime-local as UTC wall clock (matches deposit-slip OCR timestamps).
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:00.000Z`;
}

export function DepositSlipVideoReviewTable({
  rows,
  filterQuery,
  onUpdateRow,
  onDeleteRow,
  onPreviewFrame,
  rowCanVideoPreview,
}: Props) {
  const t = useTranslations("videoReview");
  const tBanks = useTranslations("bankManagement");

  const activeRows = useMemo(
    () => rows.filter((row) => row.deleted !== 1),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return activeRows;
    return activeRows.filter((row) => {
      const haystack = [
        row.ocrName,
        row.allianceRankTitle ?? "",
        row.score ?? "",
        row.profession ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activeRows, filterQuery]);

  return (
    <div className="overflow-x-auto rounded-xl border border-hq-border">
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <thead className="bg-hq-surface-muted text-xs uppercase tracking-wide text-hq-fg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">
              {tBanks("fields.commanderName")}
            </th>
            <th className="px-3 py-2 font-medium">
              {tBanks("fields.allianceTag")}
            </th>
            <th className="px-3 py-2 font-medium">{tBanks("fields.amount")}</th>
            <th className="px-3 py-2 font-medium">
              {tBanks("fields.termDays")}
            </th>
            <th className="px-3 py-2 font-medium">
              {tBanks("fields.depositAt")}
            </th>
            <th className="px-3 py-2 font-medium">{tBanks("fields.status")}</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => {
            const canPreview =
              rowCanVideoPreview?.(row.frameIndex) && onPreviewFrame;
            return (
              <tr key={row.id} className="border-t border-hq-border">
                <td className="px-3 py-2 align-top">
                  <input
                    type="text"
                    value={row.ocrName}
                    onChange={(e) =>
                      onUpdateRow(row.id, { ocrName: e.target.value })
                    }
                    className="w-full min-w-[8rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="text"
                    value={row.allianceRankTitle ?? ""}
                    onChange={(e) =>
                      onUpdateRow(row.id, {
                        allianceRankTitle: e.target.value || null,
                      })
                    }
                    className="w-full min-w-[4rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.score ?? ""}
                    onChange={(e) =>
                      onUpdateRow(row.id, { score: e.target.value || null })
                    }
                    className="w-full min-w-[5rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5 font-mono"
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <AppSelect
                    value={
                      row.memberLevel != null ? String(row.memberLevel) : ""
                    }
                    onChange={(next) => {
                      const n = Number(next);
                      onUpdateRow(row.id, {
                        memberLevel:
                          next && (DEPOSIT_TERMS as readonly number[]).includes(n)
                            ? (n as DepositTermDays)
                            : null,
                      });
                    }}
                    aria-label={tBanks("fields.termDays")}
                    options={DEPOSIT_TERMS.map((term) => ({
                      value: String(term),
                      label: String(term),
                    }))}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="datetime-local"
                    value={isoToDatetimeLocalValue(row.powerLevel)}
                    onChange={(e) =>
                      onUpdateRow(row.id, {
                        powerLevel: datetimeLocalToIso(e.target.value),
                      })
                    }
                    className="w-full min-w-[11rem] rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5"
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <AppSelect
                    value={row.profession ?? "locked"}
                    onChange={(next) =>
                      onUpdateRow(row.id, {
                        profession: (DEPOSIT_STATUSES as readonly string[]).includes(
                          next,
                        )
                          ? (next as DepositStatus)
                          : "locked",
                      })
                    }
                    aria-label={tBanks("fields.status")}
                    options={DEPOSIT_STATUSES.map((status) => ({
                      value: status,
                      label: tBanks(`status.${status}`),
                    }))}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-2">
                    {canPreview ? (
                      <button
                        type="button"
                        onClick={() => onPreviewFrame?.(row.frameIndex)}
                        className="rounded-md border border-hq-border p-1.5 text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
                        aria-label={t("rowVideoPreview")}
                      >
                        <Video className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onDeleteRow(row.id)}
                      className="rounded-md border border-hq-border px-2 py-1 text-xs text-hq-danger hover:bg-[#f8514910]"
                    >
                      {t("deleteRow")}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function useDepositSlipReviewValidation(rows: DepositSlipVideoReviewRow[]) {
  const activeRows = rows.filter((row) => row.deleted !== 1);
  const incompleteRowIds = new Set(
    activeRows
      .filter((row) => {
        const amount = row.score?.trim() ? Number(row.score) : NaN;
        return (
          !row.ocrName.trim() ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          row.memberLevel == null ||
          !row.powerLevel
        );
      })
      .map((row) => row.id),
  );
  return {
    incompleteRowIds,
    canSubmitSlips: activeRows.length > 0 && incompleteRowIds.size === 0,
  };
}
