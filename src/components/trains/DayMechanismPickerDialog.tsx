"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { TopNScopePicker } from "@/components/trains/TopNScopePicker";
import { RulePaletteOptionLabel } from "@/components/trains/TemplatePaletteBadge";
import { Dialog } from "@/components/ui/dialog";
import type { ConductorTopN } from "@/lib/trains/conductor-top-n.shared";
import {
  conductorRuleLabelKey,
  vipRuleIdentity,
  vipRuleLabelKey,
  type ConductorRule,
  type DayRulePatch,
  type VipRule,
} from "@/lib/trains/rules/catalog.shared";
import { validateConductorRuleOnDate } from "@/lib/trains/rules/derive.shared";
import {
  DAY_RULE_PALETTE,
  paletteEntryRequiresScope,
  paletteIdForRule,
  ruleForPaletteSelection,
  scopeForRule,
  type DayRulePaletteId,
} from "@/lib/trains/rules/palette.shared";

type PaintTarget = "conductor" | "vip" | "both";

const VIP_CHOICES: Array<VipRule | null> = [
  null,
  { kind: "none" },
  { kind: "donations_second" },
  { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
];

type Props = {
  open: boolean;
  /** Rule currently painted on this date; null is free choice. */
  currentRule: ConductorRule | null;
  currentVipRule: VipRule | null;
  date: string;
  leadDays?: number;
  vrReporterCount?: number;
  disabled?: boolean;
  weightingEnabled: boolean;
  onWeightingEnabledChange: (next: boolean) => void | Promise<void>;
  onClose: () => void;
  onSelect: (patch: DayRulePatch) => void;
};

export function DayMechanismPickerDialog({
  open,
  currentRule,
  currentVipRule,
  date,
  leadDays = 0,
  vrReporterCount = 0,
  disabled = false,
  weightingEnabled,
  onWeightingEnabledChange,
  onClose,
  onSelect,
}: Props) {
  const t = useTranslations("trains");
  const tRules = useTranslations("trains.rules");
  const tDayMenu = useTranslations("trains.dayTemplateMenu");
  const [target, setTarget] = useState<PaintTarget>("conductor");
  const [selected, setSelected] = useState<ConductorRule | null>(currentRule);
  const [selectedVip, setSelectedVip] = useState<VipRule | null>(
    currentVipRule,
  );
  const [scopeBoard, setScopeBoard] = useState<
    "vs_top_n" | "vr_top_n" | null
  >(null);
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

  const selectedPaletteId = paletteIdForRule(selected);
  const selectedVipIdentity = vipRuleIdentity(selectedVip);
  const showConductor = target !== "vip";
  const showVip = target !== "conductor";
  const sourceDayInvalid =
    showConductor &&
    !validateConductorRuleOnDate(selected, date, leadDays).ok;

  function labelFor(paletteId: DayRulePaletteId): string {
    const rule = ruleForPaletteSelection(
      paletteId,
      paletteId === selectedPaletteId ? scopeForRule(selected) : null,
    );
    if (paletteId === "free_choice") return tRules("freeChoice");
    return tRules(conductorRuleLabelKey(rule));
  }

  function apply() {
    const patch: DayRulePatch = {};
    if (showConductor) patch.conductorRule = selected;
    if (showVip) patch.vipRule = selectedVip;
    onSelect(patch);
  }

  const targets: Array<{ id: PaintTarget; label: string }> = [
    { id: "conductor", label: tDayMenu("targetConductor") },
    { id: "vip", label: tDayMenu("targetVip") },
    { id: "both", label: tDayMenu("targetBoth") },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setScopeBoard(null);
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

        {scopeBoard ? (
          <TopNScopePicker
            board={scopeBoard}
            vrReporterCount={vrReporterCount}
            onBack={() => setScopeBoard(null)}
            onSelect={(topN: ConductorTopN) => {
              setSelected(ruleForPaletteSelection(scopeBoard, topN));
              setScopeBoard(null);
            }}
          />
        ) : (
          <>
            <div className="border-b border-hq-border px-5 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                {tDayMenu("targetLabel")}
              </p>
              <div
                className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1"
                role="radiogroup"
                aria-label={tDayMenu("targetLabel")}
              >
                {targets.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={target === option.id}
                    disabled={disabled}
                    data-testid={`trains-day-mechanism-target-${option.id}`}
                    onClick={() => setTarget(option.id)}
                    className={`rounded-md px-2 py-2 text-center text-xs font-medium disabled:opacity-50 ${
                      target === option.id
                        ? "bg-cyan-500 text-white"
                        : "text-hq-fg-muted hover:text-hq-fg"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain px-3 py-2"
              data-testid="trains-day-mechanism-picker-list"
            >
              {showConductor ? (
                <>
                  {showVip ? (
                    <p className="px-1 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                      {tDayMenu("conductorSection")}
                    </p>
                  ) : null}
                  <div role="listbox" aria-label={tDayMenu("conductorSection")}>
                    {DAY_RULE_PALETTE.map((entry) => {
                      const isSelected = selectedPaletteId === entry.id;
                      const scope = isSelected ? scopeForRule(selected) : null;
                      const detailKey = `ruleDetails.${entry.id}` as const;
                      const detail = t.has(detailKey) ? t(detailKey) : null;

                      return (
                        <div
                          key={entry.id}
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
                            data-testid={`trains-day-rule-row-${entry.id}`}
                            onClick={() => {
                              if (paletteEntryRequiresScope(entry.id)) {
                                setScopeBoard(
                                  entry.id as "vs_top_n" | "vr_top_n",
                                );
                                return;
                              }
                              setSelected(ruleForPaletteSelection(entry.id));
                            }}
                            className="w-full text-left disabled:opacity-50"
                          >
                            <RulePaletteOptionLabel
                              paletteId={entry.id}
                              label={
                                scope != null
                                  ? `${labelFor(entry.id)} · ${scope}`
                                  : labelFor(entry.id)
                              }
                            />
                            {isSelected && detail ? (
                              <p className="mt-2 text-xs leading-relaxed text-hq-fg-muted">
                                {detail}
                              </p>
                            ) : null}
                          </button>

                          {isSelected && entry.id === "pif_weekday" ? (
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
                </>
              ) : null}

              {showVip ? (
                <>
                  {showConductor ? (
                    <p className="px-1 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                      {tDayMenu("vipSection")}
                    </p>
                  ) : null}
                  <div role="listbox" aria-label={tDayMenu("vipSection")}>
                    {VIP_CHOICES.map((rule) => {
                      const isSelected =
                        selectedVipIdentity === vipRuleIdentity(rule);
                      return (
                        <div
                          key={vipRuleIdentity(rule)}
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
                            data-testid={`trains-day-vip-row-${vipRuleIdentity(rule)}`}
                            onClick={() => setSelectedVip(rule)}
                            className="w-full text-left text-sm font-medium text-hq-fg disabled:opacity-50"
                          >
                            {tRules(vipRuleLabelKey(rule))}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>

            <div className="border-t border-hq-border px-5 py-4">
              {sourceDayInvalid ? (
                <p
                  className="mb-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400"
                  data-testid="trains-day-mechanism-source-day-warning"
                >
                  {tDayMenu("sourceDayWarning")}
                </p>
              ) : null}
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
                  onClick={apply}
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
