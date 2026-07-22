"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Info } from "lucide-react";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { fromDatetimeLocalValue } from "@/components/banks/datetime-local";
import type { BankPayload } from "@/lib/banks/api.shared";
import type { SerializedBank } from "@/lib/banks/types.shared";
import type { DetectedBankContext } from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";
import type { DetectedBankContextMatch } from "@/lib/banks/bank-context-ocr/detected-bank-context-match.shared";

type Props = {
  context: DetectedBankContext;
  match: DetectedBankContextMatch;
  onBankCreated: (bank: SerializedBank) => void;
};

export function DepositSlipBankContextPanel({
  context,
  match,
  onBankCreated,
}: Props) {
  const t = useTranslations("videoReview");
  // Parent only mounts when context is non-null so these initializers see OCR.
  const [server, setServer] = useState(() =>
    context.gameServerNumber != null ? String(context.gameServerNumber) : "",
  );
  const [coordX, setCoordX] = useState(() =>
    context.coordX != null ? String(context.coordX) : "",
  );
  const [coordY, setCoordY] = useState(() =>
    context.coordY != null ? String(context.coordY) : "",
  );
  const [level, setLevel] = useState(() =>
    context.level != null ? String(context.level) : "",
  );
  const [dropByAt, setDropByAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (match.kind === "matched") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-hq-green/40 bg-hq-green/10 px-4 py-3 text-sm text-hq-green"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <p>
          {t("bankContextMatched", {
            server: context.gameServerNumber ?? "",
            x: context.coordX ?? "",
            y: context.coordY ?? "",
          })}
        </p>
      </div>
    );
  }

  if (match.kind === "unmatched_coords") {
    const canSubmit =
      server.trim() !== "" &&
      coordX.trim() !== "" &&
      coordY.trim() !== "" &&
      level.trim() !== "" &&
      dropByAt.trim() !== "" &&
      !creating;

    const handleCreate = async () => {
      setCreateError(null);
      setCreating(true);
      try {
        const payload: BankPayload = {
          gameServerNumber: Number(server),
          coordX: Number(coordX),
          coordY: Number(coordY),
          level: Number(level),
          depositPolicy: "alliance",
          // Deposit-video create implies an alliance-held bank (same as City List).
          priorCaptureCount: 1,
          currentDepositValue: context.currentDepositValue ?? undefined,
          dropByAt: fromDatetimeLocalValue(dropByAt),
        };
        const res = await fetch("/api/banks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          error?: string;
          bank?: SerializedBank;
        };
        if (!res.ok || !data.bank) {
          setCreateError(data.error ?? t("bankContextCreateFailed"));
          return;
        }
        onBankCreated(data.bank);
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : t("bankContextCreateFailed"),
        );
      } finally {
        setCreating(false);
      }
    };

    return (
      <div className="space-y-3 rounded-xl border border-hq-accent/40 bg-[#58a6ff10] p-4">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-hq-accent" aria-hidden />
          <div>
            <p className="font-medium text-hq-fg">
              {t("bankContextNoMatchTitle")}
            </p>
            <p className="mt-1 text-sm text-hq-fg-muted">
              {t("bankContextNoMatchHint")}
            </p>
          </div>
        </div>

        {createError ? (
          <div className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
            {createError}
          </div>
        ) : null}

        <form
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void handleCreate();
          }}
        >
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">
              {t("bankContextFieldServer")}
            </span>
            <input
              type="number"
              required
              min={1}
              step={1}
              value={server}
              onChange={(event) => setServer(event.target.value)}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            />
          </label>
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("bankContextFieldX")}</span>
            <input
              type="number"
              required
              step={1}
              value={coordX}
              onChange={(event) => setCoordX(event.target.value)}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            />
          </label>
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("bankContextFieldY")}</span>
            <input
              type="number"
              required
              step={1}
              value={coordY}
              onChange={(event) => setCoordY(event.target.value)}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            />
          </label>
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">
              {t("bankContextFieldLevel")}
            </span>
            <input
              type="number"
              required
              min={1}
              step={1}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            />
          </label>
          <label className="col-span-2 block min-w-0 space-y-1 text-sm sm:col-span-4">
            <span className="text-hq-fg-muted">
              {t("bankContextFieldDropByAt")}
            </span>
            <input
              type="datetime-local"
              required
              value={dropByAt}
              onChange={(event) => setDropByAt(event.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            />
            <span className="block text-xs text-hq-fg-muted">
              {t("bankContextFieldDropByAtHint")}
            </span>
          </label>
          <div className="col-span-2 sm:col-span-4">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {creating
                ? t("bankContextCreating")
                : t("bankContextCreateSubmit")}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (match.kind === "partial") {
    const fields: Array<{ labelKey: string; value: string }> = [];
    if (context.gameServerNumber != null) {
      fields.push({
        labelKey: "bankContextFieldServer",
        value: String(context.gameServerNumber),
      });
    }
    if (context.bankName) {
      fields.push({ labelKey: "bankContextFieldBankName", value: context.bankName });
    }
    if (context.owningAllianceTag) {
      fields.push({
        labelKey: "bankContextFieldAllianceTag",
        value: context.owningAllianceTag,
      });
    }
    if (context.level != null) {
      fields.push({
        labelKey: "bankContextFieldLevel",
        value: String(context.level),
      });
    }
    if (context.currentDepositValue != null) {
      fields.push({
        labelKey: "bankContextFieldCurrentDeposit",
        value: context.currentDepositValue.toLocaleString(),
      });
    }
    if (context.depositCapacity != null) {
      fields.push({
        labelKey: "bankContextFieldDepositCapacity",
        value: context.depositCapacity.toLocaleString(),
      });
    }
    if (context.firstCaptureDate) {
      fields.push({
        labelKey: "bankContextFieldFirstCaptureDate",
        value: context.firstCaptureDate,
      });
    }

    if (fields.length === 0) return null;

    return (
      <div className="rounded-xl border border-hq-border bg-hq-surface p-4 text-sm">
        <p className="font-medium text-hq-fg">{t("bankContextPartialTitle")}</p>
        <p className="mt-1 text-hq-fg-muted">{t("bankContextPartialHint")}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {fields.map((field) => (
            <div key={field.labelKey}>
              <dt className="text-hq-fg-muted">{t(field.labelKey)}</dt>
              <dd className="text-hq-fg">{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return null;
}
