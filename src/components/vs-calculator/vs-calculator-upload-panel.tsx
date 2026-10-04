"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import type { VsCalculatorPayload } from "@/lib/vs-calculator/vs-calculator.shared";
import type { BagParseResult } from "@/lib/vs-calculator/bag-ocr/bag-ocr.shared";

type Props = {
  pinnedDate: string;
  locale: string;
  onConfirmed: (payload: VsCalculatorPayload) => void;
};

export function VsCalculatorUploadPanel({
  pinnedDate,
  locale,
  onConfirmed,
}: Props) {
  const t = useTranslations("vsCalculator.upload");
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<BagParseResult | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"merge" | "replace">("merge");

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      setError(null);
      setParseResult(null);
      try {
        const body = new FormData();
        body.append("image", file);
        const res = await fetch("/api/tools/vs-calculator/inventory/parse", {
          method: "POST",
          body,
        });
        const json = (await res.json()) as BagParseResult & { error?: string };
        if (!res.ok) throw new Error(json.error ?? t("parseFailed"));
        setParseResult(json);
        const next: Record<string, number> = {};
        for (const row of json.matched) {
          next[row.slug] = row.quantity;
        }
        setQuantities(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("parseFailed"));
      } finally {
        setParsing(false);
      }
    },
    [t],
  );

  const confirm = useCallback(async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/vs-calculator/inventory/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantities,
          mode,
          pinnedDate,
          locale,
        }),
      });
      const body = (await res.json()) as VsCalculatorPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("confirmFailed"));
      onConfirmed(body);
      setParseResult(null);
      setQuantities({});
    } catch (err) {
      setError(err instanceof Error ? err.message : t("confirmFailed"));
    } finally {
      setConfirming(false);
    }
  }, [locale, mode, onConfirmed, pinnedDate, quantities, t]);

  return (
    <section className="space-y-4" role="tabpanel">
      <p className="text-sm text-hq-fg-muted">{t("hint")}</p>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hq-border bg-hq-surface p-6 text-center">
        <span className="text-sm font-medium text-hq-fg">
          {parsing ? t("parsing") : t("chooseImage")}
        </span>
        <span className="text-xs text-hq-fg-muted">{t("formats")}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={parsing || confirming}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </label>

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      {parseResult ? (
        <div className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4">
          <p className="text-xs text-hq-fg-muted">
            {t("gridInfo", {
              cols: parseResult.grid.cols,
              rows: parseResult.grid.rows,
              ms: parseResult.durationMs,
            })}
          </p>

          {parseResult.matched.length === 0 ? (
            <p className="text-sm text-hq-fg-muted">{t("noMatches")}</p>
          ) : (
            <ul className="space-y-2">
              {parseResult.matched.map((row) => (
                <li
                  key={row.slug}
                  className="flex flex-col gap-2 rounded-lg border border-hq-border bg-hq-canvas p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-hq-fg">{row.displayName}</p>
                    <p className="text-xs text-hq-fg-muted">
                      {t("confidence", {
                        pct: Math.round(row.confidence * 100),
                      })}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="h-9 w-full max-w-[8rem] rounded-lg border border-hq-border bg-hq-surface px-3 text-center font-mono text-sm text-hq-fg sm:w-28"
                    value={quantities[row.slug] ?? 0}
                    onChange={(e) => {
                      const next = Number.parseInt(e.target.value, 10);
                      setQuantities((q) => ({
                        ...q,
                        [row.slug]: Number.isFinite(next) ? Math.max(0, next) : 0,
                      }));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          {parseResult.unknown.length > 0 ? (
            <p className="text-xs text-hq-fg-muted">
              {t("unknownCount", { count: parseResult.unknown.length })}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm text-hq-fg">
              <select
                className="rounded-lg border border-hq-border bg-hq-canvas px-2 py-1 text-sm"
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value === "replace" ? "replace" : "merge")
                }
              >
                <option value="merge">{t("modeMerge")}</option>
                <option value="replace">{t("modeReplace")}</option>
              </select>
            </label>
            <button
              type="button"
              disabled={confirming || Object.keys(quantities).length === 0}
              className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-hq-accent-fg disabled:opacity-50"
              onClick={() => void confirm()}
            >
              {confirming ? t("confirming") : t("confirm")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
