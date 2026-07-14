"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { TemplatePaletteOptionLabel } from "@/components/trains/TemplatePaletteBadge";
import { Dialog } from "@/components/ui/dialog";
import {
  SELECTABLE_WEEK_TEMPLATES,
  WEEK_TEMPLATES_WITH_DETAIL_HINTS,
} from "@/lib/trains/week-template-registry.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  open: boolean;
  currentTemplate: WeekTemplateType;
  disabled?: boolean;
  onClose: () => void;
  /** Called when the officer confirms a template (may equal current). */
  onSelect: (templateType: WeekTemplateType) => void;
};

export function WeekTemplatePickerDialog({
  open,
  currentTemplate,
  disabled = false,
  onClose,
  onSelect,
}: Props) {
  const t = useTranslations("trains");
  // Parent remounts via `key` when opening so selection resets to currentTemplate.
  const [selected, setSelected] = useState<WeekTemplateType>(currentTemplate);

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
          <p className="mt-1 text-sm text-hq-fg-muted">
            {t("templatePicker.subtitle")}
          </p>
        </div>

        <div
          className="max-h-[min(55vh,420px)] overflow-y-auto px-3 py-2"
          data-testid="trains-template-picker-list"
          role="listbox"
          aria-label={t("templateSelectAria")}
        >
          {SELECTABLE_WEEK_TEMPLATES.map((template) => {
            const isSelected = selected === template;
            const detail = WEEK_TEMPLATES_WITH_DETAIL_HINTS.includes(template)
              ? t(`templateDetails.${template}`)
              : null;

            return (
              <button
                key={template}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                data-testid={`trains-template-picker-row-${template}`}
                onClick={() => setSelected(template)}
                className={`w-full rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-50 ${
                  isSelected
                    ? "border-cyan-500/50 bg-cyan-500/10"
                    : "border-transparent hover:bg-hq-canvas"
                }`}
              >
                <TemplatePaletteOptionLabel
                  template={template}
                  label={t(`templates.${template}`)}
                />
                {isSelected && detail ? (
                  <p
                    className="mt-2 text-xs leading-relaxed text-hq-fg-muted"
                    data-testid="trains-template-picker-detail"
                  >
                    {detail}
                  </p>
                ) : null}
              </button>
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
