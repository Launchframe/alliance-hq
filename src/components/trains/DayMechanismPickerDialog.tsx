"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { TopNScopePicker } from "@/components/trains/TopNScopePicker";
import { TemplatePaletteOptionLabel } from "@/components/trains/TemplatePaletteBadge";
import { Dialog } from "@/components/ui/dialog";
import {
  isTopNPaintTemplate,
  type ConductorTopN,
} from "@/lib/trains/conductor-top-n.shared";
import { DAY_PAINT_TEMPLATES } from "@/lib/trains/paint-templates.shared";
import { generateDayConfigForDate } from "@/lib/trains/templates";
import { WEEK_TEMPLATES_WITH_DETAIL_HINTS } from "@/lib/trains/week-template-registry.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  currentTemplate: WeekTemplateType;
  date: string;
  weekStart: string;
  vrReporterCount?: number;
  disabled?: boolean;
  weightingEnabled: boolean;
  onWeightingEnabledChange: (next: boolean) => void | Promise<void>;
  onClose: () => void;
  onSelect: (templateType: WeekTemplateType, topN?: ConductorTopN) => void;
};

export function DayMechanismPickerDialog({
  open,
  currentTemplate,
  date,
  weekStart,
  vrReporterCount = 0,
  disabled = false,
  weightingEnabled,
  onWeightingEnabledChange,
  onClose,
  onSelect,
}: Props) {
  const t = useTranslations("trains");
  const tGuided = useTranslations("trains.guidedFlow");
  const tDayMenu = useTranslations("trains.dayTemplateMenu");
  const [selected, setSelected] = useState<WeekTemplateType>(currentTemplate);
  const [scopeTemplate, setScopeTemplate] = useState<"top_vs" | "top_vr" | null>(
    null,
  );
  const [weightingBusy, setWeightingBusy] = useState(false);

  async function setDrawMode(nextWeightingEnabled: boolean) {
    if (disabled || weightingBusy) return;
    if (nextWeightingEnabled === weightingEnabled) return;
    setWeightingBusy(true);
    try {
      await onWeightingEnabledChange(nextWeightingEnabled);
    } finally {
      setWeightingBusy(false);
    }
  }

  const selectedVipMechanism = generateDayConfigForDate(
    selected,
    date,
    weekStart,
  ).vipMechanism;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setScopeTemplate(null);
          onClose();
        }
      }}
      title={tDayMenu("title")}
      className="max-w-lg p-0"
    >
      <div className="flex flex-col">
        <div className="border-b border-hq-border px-5 py-4">
          <h2 className="text-lg font-semibold text-hq-fg">
            {tDayMenu("title")}
          </h2>
          <p className="mt-1 text-xs text-hq-fg-muted">
            {tDayMenu("dialogSubtitle")}
          </p>
          <p className="mt-0.5 text-[10px] tabular-nums text-hq-fg-subtle">
            {date}
          </p>
        </div>

        {scopeTemplate ? (
          <TopNScopePicker
            paintTemplate={scopeTemplate}
            vrReporterCount={vrReporterCount}
            onBack={() => setScopeTemplate(null)}
            onSelect={(topN) => {
              onSelect(scopeTemplate, topN);
              setScopeTemplate(null);
            }}
          />
        ) : (
          <>
            <div
              className="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain px-3 py-2"
              data-testid="trains-day-mechanism-picker-list"
              role="listbox"
              aria-label={tDayMenu("ariaLabel", { date })}
            >
              {DAY_PAINT_TEMPLATES.map((template) => {
                const isSelected = selected === template;
                const detail = WEEK_TEMPLATES_WITH_DETAIL_HINTS.includes(template)
                  ? t(`templateDetails.${template}`)
                  : null;

                return (
                  <div
                    key={template}
                    className={`rounded-lg border px-3 py-3 transition-colors ${
                      isSelected
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : "border-transparent hover:bg-hq-canvas"
                    }`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={disabled}
                      data-testid={`trains-day-mechanism-picker-row-${template}`}
                      onClick={() => {
                        if (isTopNPaintTemplate(template)) {
                          setScopeTemplate(template);
                          return;
                        }
                        setSelected(template);
                      }}
                      className="w-full text-left disabled:opacity-50"
                    >
                      <TemplatePaletteOptionLabel
                        template={template}
                        label={t(`templates.${template}`)}
                      />
                      {isSelected && detail ? (
                        <p className="mt-2 text-xs leading-relaxed text-hq-fg-muted">
                          {detail}
                        </p>
                      ) : null}
                    </button>

                    {isSelected && template === "price_is_right_weekdays" ? (
                      <div
                        className="mt-3 border-t border-hq-border/60 pt-3"
                        data-testid="trains-day-mechanism-picker-pir-mode"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <p className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                          {t("templatePicker.drawModeLabel")}
                        </p>
                        <div
                          className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1"
                          role="radiogroup"
                          aria-label={t("templatePicker.drawModeLabel")}
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!weightingEnabled}
                            disabled={disabled || weightingBusy}
                            data-testid="trains-day-pir-mode-equal-chance"
                            onClick={() => void setDrawMode(false)}
                            className={`rounded-md px-2 py-2 text-center text-xs font-medium disabled:opacity-50 ${
                              !weightingEnabled
                                ? "bg-cyan-500 text-white"
                                : "text-hq-fg-muted hover:text-hq-fg"
                            }`}
                          >
                            {t("templatePicker.equalChance")}
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={weightingEnabled}
                            disabled={disabled || weightingBusy}
                            data-testid="trains-day-pir-mode-closer-is-better"
                            onClick={() => void setDrawMode(true)}
                            className={`rounded-md px-2 py-2 text-center text-xs font-medium disabled:opacity-50 ${
                              weightingEnabled
                                ? "bg-cyan-500 text-white"
                                : "text-hq-fg-muted hover:text-hq-fg"
                            }`}
                          >
                            {t("templatePicker.closerIsBetter")}
                          </button>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-hq-fg-muted">
                          {weightingEnabled
                            ? t("templatePicker.closerIsBetterHint")
                            : t("templatePicker.equalChanceHint")}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {selectedVipMechanism === "none" ? (
              <p className="border-t border-hq-border px-5 py-2 text-xs text-hq-fg-muted">
                {tGuided("steps.vip.skipped")}
              </p>
            ) : null}

            <div className="border-t border-hq-border px-5 py-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
                >
                  {t("templatePicker.cancel")}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  data-testid="trains-day-mechanism-picker-apply"
                  onClick={() => onSelect(selected)}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
                >
                  {t("templatePicker.apply")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
