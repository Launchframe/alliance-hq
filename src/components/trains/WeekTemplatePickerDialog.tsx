"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { TemplateWeekShapeStrip } from "@/components/trains/TemplateWeekShapeStrip";
import { Dialog } from "@/components/ui/dialog";
import { WEEK_TEMPLATES, type WeekTemplateType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  currentTemplate: WeekTemplateType;
  disabled?: boolean;
  /** Alliance Price Is Freight draw mode (`weightingEnabled`). */
  weightingEnabled: boolean;
  onWeightingEnabledChange: (next: boolean) => void | Promise<void>;
  onClose: () => void;
  /** Called when the officer confirms a template (may equal current). */
  onSelect: (templateType: WeekTemplateType) => void;
};

export function WeekTemplatePickerDialog({
  open,
  currentTemplate,
  disabled = false,
  weightingEnabled,
  onWeightingEnabledChange,
  onClose,
  onSelect,
}: Props) {
  const t = useTranslations("trains");
  // Parent remounts via `key` when opening so selection resets to currentTemplate.
  const [selected, setSelected] = useState<WeekTemplateType>(currentTemplate);
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("templatePicker.title")}
      className="max-w-lg p-0"
    >
      <div className="flex flex-col">
        <div className="border-b border-hq-border px-5 py-4">
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("templatePicker.title")}
          </h2>
        </div>

        <div
          className="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain px-3 py-2"
          data-testid="trains-template-picker-list"
          role="listbox"
          aria-label={t("templateSelectAria")}
        >
          {WEEK_TEMPLATES.map((template) => {
            const isSelected = selected === template;
            const detailKey = `templateDetails.${template}` as const;
            const detail = t.has(detailKey) ? t(detailKey) : null;

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
                  data-testid={`trains-template-picker-row-${template}`}
                  onClick={() => setSelected(template)}
                  className="w-full text-left disabled:opacity-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{t(`templates.${template}`)}</span>
                  </span>
                  {isSelected ? (
                    <div
                      className="mt-2 space-y-2"
                      data-testid="trains-template-picker-detail"
                    >
                      <TemplateWeekShapeStrip template={template} />
                      {detail ? (
                        <p className="text-xs leading-relaxed text-hq-fg-muted">
                          {detail}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </button>

                {isSelected && template === "price_is_right" ? (
                  <div
                    className="mt-3 border-t border-hq-border/60 pt-3"
                    data-testid="trains-template-picker-pir-mode"
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
                        data-testid="trains-pir-mode-equal-chance"
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
                        data-testid="trains-pir-mode-closer-is-better"
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
              data-testid="trains-template-picker-apply"
              onClick={() => onSelect(selected)}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
            >
              {t("templatePicker.apply")}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
