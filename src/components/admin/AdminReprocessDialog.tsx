"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
import {
  canDecreaseFps,
  canIncreaseFps,
  normalizeExtractionConfig,
  passKeyForExtractionConfig,
  resolveSimpleReprocessExtraction,
  simpleLadderBaseFps,
  summarizeExtractionConfig,
  type AdminReprocessFpsAdjustment,
} from "@/lib/video/admin-reprocess-extraction.shared";

type ParseConfigOption = {
  id: string;
  name: string;
  passKey: string;
  configJson: unknown;
};

type Props = {
  open: boolean;
  jobId: string;
  passKey: string | null;
  extractionConfigJson: unknown;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (body: {
    adjustment?: AdminReprocessFpsAdjustment;
    extraction?: ExtractionConfig;
    parseConfigId?: string;
  }) => void;
};

export function AdminReprocessDialog({
  open,
  jobId,
  passKey,
  extractionConfigJson,
  busy,
  onOpenChange,
  onConfirm,
}: Props) {
  const t = useTranslations("admin.videoJobsPage");
  const current = useMemo(
    () => normalizeExtractionConfig(extractionConfigJson),
    [extractionConfigJson],
  );
  const currentSummary = current
    ? summarizeExtractionConfig(current)
    : passKey ?? "—";
  const currentPassKey =
    passKey ?? (current ? passKeyForExtractionConfig(current) : "—");

  const initialAdvanced = current
    ? {
        mode: current.mode,
        sampleFps: String(
          current.sampleFps ?? (current.mode === "fps" ? 3 : 1),
        ),
        sceneThreshold: String(current.sceneThreshold ?? 0.25),
      }
    : { mode: "fps" as const, sampleFps: "3", sceneThreshold: "0.25" };

  const [adjustment, setAdjustment] =
    useState<AdminReprocessFpsAdjustment>("keep");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mode, setMode] = useState<"fps" | "scene">(initialAdvanced.mode);
  const [sampleFps, setSampleFps] = useState(initialAdvanced.sampleFps);
  const [sceneThreshold, setSceneThreshold] = useState(
    initialAdvanced.sceneThreshold,
  );
  const [parseConfigId, setParseConfigId] = useState("");
  const [parseConfigs, setParseConfigs] = useState<ParseConfigOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !advancedOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/parse-configs?status=active");
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { configs: ParseConfigOption[] };
        if (cancelled) return;
        setParseConfigs(
          data.configs.filter((row) => {
            const cfg = normalizeExtractionConfig(row.configJson);
            return cfg != null;
          }),
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t("actionFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, advancedOpen, t]);

  const ladderBase = current ? simpleLadderBaseFps(current) : 2;
  const increaseDisabled = !canIncreaseFps(ladderBase);
  const decreaseDisabled = !canDecreaseFps(ladderBase);

  const previewSimple = current
    ? resolveSimpleReprocessExtraction(current, adjustment)
    : null;

  const advancedConfig = useMemo((): ExtractionConfig | null => {
    const fps = Number(sampleFps);
    const threshold = Number(sceneThreshold);
    if (mode === "fps") {
      if (!Number.isFinite(fps) || fps <= 0) return null;
      return { mode: "fps", sampleFps: fps };
    }
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      return null;
    }
    return {
      mode: "scene",
      sceneThreshold: threshold,
      sampleFps: Number.isFinite(fps) && fps > 0 ? fps : 1,
    };
  }, [mode, sampleFps, sceneThreshold]);

  const previewPassKey = advancedOpen
    ? advancedConfig
      ? passKeyForExtractionConfig(advancedConfig)
      : "—"
    : previewSimple
      ? passKeyForExtractionConfig(previewSimple.config)
      : currentPassKey;

  function applyParseConfig(id: string) {
    setParseConfigId(id);
    if (!id) return;
    const row = parseConfigs.find((c) => c.id === id);
    if (!row) return;
    const cfg = normalizeExtractionConfig(row.configJson);
    if (!cfg) return;
    setMode(cfg.mode);
    setSampleFps(String(cfg.sampleFps ?? (cfg.mode === "fps" ? 3 : 1)));
    setSceneThreshold(String(cfg.sceneThreshold ?? 0.25));
  }

  function handleConfirm() {
    if (advancedOpen) {
      if (!advancedConfig) return;
      onConfirm({
        extraction: advancedConfig,
        ...(parseConfigId ? { parseConfigId } : {}),
      });
      return;
    }
    onConfirm({ adjustment });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("reprocessDialogTitle")}
      className="max-w-lg"
    >
      <div className="space-y-4 p-4" data-job-id={jobId}>
        <div>
          <h2 className="text-sm font-medium text-hq-fg">
            {t("reprocessDialogTitle")}
          </h2>
          <p className="mt-2 text-sm text-hq-fg-muted">
            {t("reprocessDialogBody", {
              passKey: currentPassKey,
              summary: currentSummary,
            })}
          </p>
        </div>

        {!advancedOpen ? (
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("reprocessDialogTitle")}</legend>
            {(
              [
                ["keep", t("reprocessKeep")],
                ["increase", t("reprocessIncrease")],
                ["decrease", t("reprocessDecrease")],
              ] as const
            ).map(([value, label]) => {
              const disabled =
                (value === "increase" && increaseDisabled) ||
                (value === "decrease" && decreaseDisabled);
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                    adjustment === value
                      ? "border-hq-accent bg-hq-accent/10 text-hq-fg"
                      : "border-hq-border text-hq-fg"
                  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input
                    type="radio"
                    name="reprocess-adjustment"
                    value={value}
                    checked={adjustment === value}
                    disabled={disabled}
                    onChange={() => setAdjustment(value)}
                    className="mt-0.5"
                  />
                  <span>
                    {label}
                    {value === "increase" && increaseDisabled ? (
                      <span className="mt-0.5 block text-xs text-hq-fg-muted">
                        {t("reprocessAtMax")}
                      </span>
                    ) : null}
                    {value === "decrease" && decreaseDisabled ? (
                      <span className="mt-0.5 block text-xs text-hq-fg-muted">
                        {t("reprocessAtMin")}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-hq-fg-muted">{t("reprocessAdvancedHint")}</p>
            {loadError ? (
              <p className="text-xs text-hq-danger">{loadError}</p>
            ) : null}
            <div>
              <label className="mb-1 block text-xs text-hq-fg-muted">
                {t("reprocessPickConfig")}
              </label>
              <select
                value={parseConfigId}
                onChange={(e) => applyParseConfig(e.target.value)}
                className="w-full rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-sm text-hq-fg"
              >
                <option value="">{t("reprocessPickConfigNone")}</option>
                {parseConfigs.map((cfg) => (
                  <option key={cfg.id} value={cfg.id}>
                    {cfg.name} ({cfg.passKey})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-hq-fg-muted">
                {t("reprocessMode")}
              </label>
              <select
                value={mode}
                onChange={(e) => {
                  setParseConfigId("");
                  setMode(e.target.value as "fps" | "scene");
                }}
                className="w-full rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-sm text-hq-fg"
              >
                <option value="fps">{t("reprocessModeFps")}</option>
                <option value="scene">{t("reprocessModeScene")}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-hq-fg-muted">
                {t("reprocessSampleFps")}
              </label>
              <input
                type="number"
                min={0.1}
                step="any"
                value={sampleFps}
                onChange={(e) => {
                  setParseConfigId("");
                  setSampleFps(e.target.value);
                }}
                className="w-full rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-sm text-hq-fg"
              />
            </div>
            {mode === "scene" ? (
              <div>
                <label className="mb-1 block text-xs text-hq-fg-muted">
                  {t("reprocessSceneThreshold")}
                </label>
                <input
                  type="number"
                  min={0.01}
                  max={1}
                  step="any"
                  value={sceneThreshold}
                  onChange={(e) => {
                    setParseConfigId("");
                    setSceneThreshold(e.target.value);
                  }}
                  className="w-full rounded-lg border border-hq-border bg-hq-surface px-2 py-1.5 text-sm text-hq-fg"
                />
              </div>
            ) : null}
          </div>
        )}

        <p className="font-mono text-xs text-hq-fg-muted">
          → {previewPassKey}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hq-border pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs text-hq-accent hover:underline"
          >
            {t("reprocessAdvanced")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
            >
              {t("reprocessCancel")}
            </button>
            <button
              type="button"
              disabled={busy || (advancedOpen && !advancedConfig)}
              onClick={handleConfirm}
              className="rounded-lg bg-hq-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {t("reprocessConfirm")}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
