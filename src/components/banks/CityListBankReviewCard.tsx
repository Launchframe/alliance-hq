"use client";

import { Building2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  formatCrystalGoldAsK,
  parseCrystalGoldKInput,
} from "@/lib/banks/crystal-gold-k.shared";
import {
  isCityListPlaceholderCoords,
  type CityListRowErrors,
  type CityListRowFieldName,
} from "@/lib/banks/city-list-import-review.shared";
import { bankDepositCapacity } from "@/lib/banks/types.shared";

export type CityListReviewCardRow = {
  rowKey: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  currentDepositValue: number | null;
  currentDepositCount: number | null;
};

type Props = {
  row: CityListReviewCardRow;
  statusLabel: string;
  isPlaceholder: boolean;
  errors: CityListRowErrors;
  showErrors: (field: CityListRowFieldName) => boolean;
  onTouchField: (field: CityListRowFieldName) => void;
  onChange: (patch: Partial<CityListReviewCardRow>) => void;
  onRemove: () => void;
  deleteLabel: string;
  amountInvalidMsg: string;
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Editable City List tile — layout mirrors the in-game bank card so officers
 * can eyeball against the screenshot (amount top-right, Lv under art, coords
 * bar, deposits footer).
 */
export function CityListBankReviewCard({
  row,
  statusLabel,
  isPlaceholder,
  errors,
  showErrors,
  onTouchField,
  onChange,
  onRemove,
  deleteLabel,
  amountInvalidMsg,
}: Props) {
  const t = useTranslations("bankManagement");
  const [amountDraft, setAmountDraft] = useState(() =>
    formatCrystalGoldAsK(row.currentDepositValue),
  );
  const [amountLocalError, setAmountLocalError] = useState<string | null>(null);

  const depositMax = bankDepositCapacity(row.level);
  const inputErr = "border-hq-danger";
  const inputOk = "border-hq-border/60";

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm",
        isPlaceholder
          ? "border-dashed border-hq-warning/50 bg-hq-warning/5"
          : "border-hq-border bg-gradient-to-b from-amber-50/90 to-orange-50/80 dark:from-amber-950/40 dark:to-orange-950/30",
      )}
      data-testid="city-list-review-card"
      data-placeholder={isPlaceholder ? "true" : "false"}
    >
      {/* Header: status/delete + CrystalGold K */}
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              isPlaceholder
                ? "border-hq-warning/40 text-hq-warning"
                : "border-hq-border bg-hq-canvas/80 text-hq-fg-muted",
            )}
          >
            {statusLabel}
          </span>
          <button
            type="button"
            aria-label={deleteLabel}
            className="rounded border border-hq-border/60 p-1 text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <input
            type="text"
            inputMode="decimal"
            aria-label={t("cityListAmountKLabel")}
            placeholder="0.00K"
            className={cn(
              "w-full max-w-[7.5rem] rounded border bg-white/80 px-2 py-1 text-right font-mono text-sm font-semibold text-amber-900 dark:bg-hq-canvas/80 dark:text-amber-100",
              (amountLocalError ||
                (showErrors("currentDepositValue") &&
                  errors.currentDepositValue)) &&
                inputErr
                ? inputErr
                : inputOk,
            )}
            value={amountDraft}
            onChange={(event) => {
              setAmountDraft(event.target.value);
              setAmountLocalError(null);
            }}
            onBlur={() => {
              onTouchField("currentDepositValue");
              const trimmed = amountDraft.trim();
              if (!trimmed) {
                setAmountDraft("");
                setAmountLocalError(null);
                onChange({ currentDepositValue: null });
                return;
              }
              const parsed = parseCrystalGoldKInput(trimmed);
              if (parsed == null) {
                setAmountLocalError(amountInvalidMsg);
                return;
              }
              setAmountLocalError(null);
              setAmountDraft(formatCrystalGoldAsK(parsed));
              onChange({ currentDepositValue: parsed });
            }}
          />
          {amountLocalError ? (
            <p className="mt-0.5 text-[10px] text-hq-danger">{amountLocalError}</p>
          ) : null}
        </div>
      </div>

      {/* Art / crop slot (reserved) */}
      <div className="mx-3 mt-2 flex aspect-[4/3] items-center justify-center rounded-lg border border-hq-border/40 bg-hq-canvas/50">
        <Building2
          className="h-10 w-10 text-hq-fg-subtle/60"
          aria-hidden
        />
      </div>

      {/* Level */}
      <div className="mt-2 flex items-center justify-center gap-1 px-3">
        <span className="text-sm font-semibold text-hq-fg" aria-hidden>
          Lv.
        </span>
        <input
          type="number"
          min={1}
          step={1}
          aria-label={t("fields.level")}
          className={cn(
            "w-14 rounded border bg-white/80 px-2 py-1 text-center text-sm font-semibold dark:bg-hq-canvas/80",
            showErrors("level") && errors.level ? inputErr : inputOk,
          )}
          value={row.level}
          onChange={(event) =>
            onChange({ level: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("level")}
        />
      </div>
      {showErrors("level") && errors.level ? (
        <p className="px-3 text-center text-[10px] text-hq-danger">
          {errors.level}
        </p>
      ) : null}

      {/* Coords bar */}
      <div className="mx-3 mt-2 flex flex-wrap items-center gap-1 rounded-md bg-emerald-800/90 px-2 py-1.5 font-mono text-xs text-emerald-50">
        <span aria-hidden>#</span>
        <input
          type="number"
          min={1}
          step={1}
          aria-label={t("fields.server")}
          className={cn(
            "w-14 rounded border bg-emerald-950/40 px-1 py-0.5 text-emerald-50",
            showErrors("gameServerNumber") && errors.gameServerNumber
              ? "border-hq-danger"
              : "border-emerald-600/50",
          )}
          value={row.gameServerNumber || ""}
          onChange={(event) =>
            onChange({ gameServerNumber: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("gameServerNumber")}
        />
        <span aria-hidden>(X:</span>
        <input
          type="number"
          step={1}
          aria-label={t("fields.coordX")}
          className={cn(
            "w-12 rounded border bg-emerald-950/40 px-1 py-0.5 text-emerald-50",
            showErrors("coordX") && errors.coordX
              ? "border-hq-danger"
              : "border-emerald-600/50",
          )}
          value={
            isCityListPlaceholderCoords(row.coordX, row.coordY) ? "" : row.coordX
          }
          onChange={(event) =>
            onChange({ coordX: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("coordX")}
        />
        <span aria-hidden>, Y:</span>
        <input
          type="number"
          step={1}
          aria-label={t("fields.coordY")}
          className={cn(
            "w-12 rounded border bg-emerald-950/40 px-1 py-0.5 text-emerald-50",
            showErrors("coordY") && errors.coordY
              ? "border-hq-danger"
              : "border-emerald-600/50",
          )}
          value={
            isCityListPlaceholderCoords(row.coordX, row.coordY) ? "" : row.coordY
          }
          onChange={(event) =>
            onChange({ coordY: Number(event.target.value) || 0 })
          }
          onBlur={() => onTouchField("coordY")}
        />
        <span aria-hidden>)</span>
      </div>
      {(showErrors("coordX") && errors.coordX) ||
      (showErrors("coordY") && errors.coordY) ||
      (showErrors("gameServerNumber") && errors.gameServerNumber) ? (
        <p className="px-3 pt-0.5 text-[10px] text-hq-danger">
          {errors.gameServerNumber ?? errors.coordX ?? errors.coordY}
        </p>
      ) : null}

      {/* Deposits footer */}
      <div className="mt-2 flex items-center justify-center gap-1 border-t border-hq-border/40 bg-white/70 px-3 py-2 dark:bg-hq-canvas/40">
        <input
          type="number"
          min={0}
          max={depositMax}
          step={1}
          aria-label={t("cityListDepositCountLabel")}
          className="w-14 rounded border border-hq-border bg-hq-canvas px-2 py-1 text-center text-sm"
          value={row.currentDepositCount ?? ""}
          onChange={(event) =>
            onChange({
              currentDepositCount: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
        />
        <span className="text-sm text-hq-fg-muted">/{depositMax}</span>
      </div>
    </article>
  );
}
