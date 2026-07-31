"use client";

import {
  History,
  ImageDown,
  Lock,
  LockOpen,
  Palette,
  UserRoundPen,
  Users,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { TemplatePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import { TopNScopePicker } from "@/components/trains/TopNScopePicker";
import { TEMPLATE_PALETTE_STYLES } from "@/lib/trains/mechanism-styles";
import { DAY_PAINT_TEMPLATES } from "@/lib/trains/paint-templates.shared";
import { SELECTABLE_WEEK_TEMPLATES } from "@/lib/trains/week-template-registry.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import { isTopNPaintTemplate } from "@/lib/trains/conductor-top-n.shared";

type Props = {
  selectedDates: string[];
  focusDate: string;
  today: string;
  hasConductor: boolean;
  locked: boolean;
  canUnlock: boolean;
  canShareImage: boolean;
  canSpinSelected: boolean;
  spinDisabledReason?: string | null;
  templateLabels: Record<string, string>;
  vrReporterCount: number;
  busy?: boolean;
  onPaint: (
    dates: string[],
    template: WeekTemplateType,
    options?: { topN?: number },
  ) => void;
  onSpinSelected: () => void;
  onManualPick: () => void;
  onLockUnlock: () => void;
  onShareImage: () => void;
  onViewHistory: () => void;
  onViewPool: () => void;
};

function ToolbarIconButton({
  label,
  disabled,
  busy,
  active,
  testId,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  active?: boolean;
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      data-testid={testId}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-hq-accent bg-hq-accent/15 text-hq-accent"
          : "border-hq-border bg-hq-surface text-hq-fg hover:bg-hq-canvas"
      }`}
    >
      {children}
    </button>
  );
}

export function TrainMonthToolbar({
  selectedDates,
  focusDate,
  today,
  hasConductor,
  locked,
  canUnlock,
  canShareImage,
  canSpinSelected,
  spinDisabledReason,
  templateLabels,
  vrReporterCount,
  busy = false,
  onPaint,
  onSpinSelected,
  onManualPick,
  onLockUnlock,
  onShareImage,
  onViewHistory,
  onViewPool,
}: Props) {
  const t = useTranslations("trains.monthToolbar");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingScopeTemplate, setPendingScopeTemplate] =
    useState<WeekTemplateType | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<WeekTemplateType | null>(
    null,
  );

  const selectedCount = selectedDates.length;
  const hasSelection = selectedCount > 0;
  const singleDay = selectedCount === 1;
  const paletteTemplates =
    selectedCount > 1 ? SELECTABLE_WEEK_TEMPLATES : DAY_PAINT_TEMPLATES;

  const canManualPick = singleDay;
  const canLockUnlock =
    singleDay &&
    hasConductor &&
    (locked ? canUnlock : focusDate <= today);
  const canHistory = singleDay && hasConductor;
  const canPool = singleDay;

  function handlePaletteClick(template: WeekTemplateType) {
    if (!hasSelection) return;
    if (isTopNPaintTemplate(template)) {
      setPendingScopeTemplate(template);
      return;
    }
    setActiveTemplate(template);
    onPaint(selectedDates, template);
    setPaletteOpen(false);
    setPendingScopeTemplate(null);
  }

  function handleScopeSelect(topN: number) {
    if (!pendingScopeTemplate || !hasSelection) return;
    setActiveTemplate(pendingScopeTemplate);
    onPaint(selectedDates, pendingScopeTemplate, { topN });
    setPendingScopeTemplate(null);
    setPaletteOpen(false);
  }

  return (
    <div
      className="rounded-xl border border-hq-border bg-hq-surface/60 p-3 shadow-sm"
      data-testid="trains-month-toolbar"
    >
      <p className="text-xs font-medium text-hq-fg-muted">{t("title")}</p>
      <p className="mt-0.5 text-[10px] text-hq-fg-subtle">{t("hint")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <div className="relative flex items-center gap-1">
          <ToolbarIconButton
            label={t("palette")}
            disabled={!hasSelection}
            busy={busy}
            active={paletteOpen || activeTemplate != null}
            testId="trains-month-toolbar-palette"
            onClick={() => setPaletteOpen((open) => !open)}
          >
            <Palette className="h-4 w-4" aria-hidden />
          </ToolbarIconButton>
          {activeTemplate ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-hq-border px-1.5 py-0.5 text-[10px] font-medium text-hq-fg-muted"
              data-testid="trains-month-toolbar-active-rule"
            >
              <TemplatePaletteBadge template={activeTemplate} shape="square" />
              {templateLabels[activeTemplate] ?? activeTemplate}
            </span>
          ) : null}
        </div>

        <ToolbarIconButton
          label={
            spinDisabledReason && !canSpinSelected
              ? spinDisabledReason
              : t("spinSelected")
          }
          disabled={!canSpinSelected}
          busy={busy}
          testId="trains-month-toolbar-spin"
          onClick={onSpinSelected}
        >
          <Wand2 className="h-4 w-4" aria-hidden />
        </ToolbarIconButton>

        <ToolbarIconButton
          label={t("manualPick")}
          disabled={!canManualPick}
          busy={busy}
          testId="trains-month-toolbar-manual-pick"
          onClick={onManualPick}
        >
          <UserRoundPen className="h-4 w-4" aria-hidden />
        </ToolbarIconButton>

        <ToolbarIconButton
          label={locked ? t("unlock") : t("lock")}
          disabled={!canLockUnlock}
          busy={busy}
          testId="trains-month-toolbar-lock"
          onClick={onLockUnlock}
        >
          {locked ? (
            <LockOpen className="h-4 w-4" aria-hidden />
          ) : (
            <Lock className="h-4 w-4" aria-hidden />
          )}
        </ToolbarIconButton>

        <ToolbarIconButton
          label={t("shareImage")}
          disabled={!canShareImage}
          busy={busy}
          testId="trains-month-toolbar-share"
          onClick={onShareImage}
        >
          <ImageDown className="h-4 w-4" aria-hidden />
        </ToolbarIconButton>

        <ToolbarIconButton
          label={t("viewHistory")}
          disabled={!canHistory}
          busy={busy}
          testId="trains-month-toolbar-history"
          onClick={onViewHistory}
        >
          <History className="h-4 w-4" aria-hidden />
        </ToolbarIconButton>

        <ToolbarIconButton
          label={t("viewEligibility")}
          disabled={!canPool}
          busy={busy}
          testId="trains-month-toolbar-pool"
          onClick={onViewPool}
        >
          <Users className="h-4 w-4" aria-hidden />
        </ToolbarIconButton>
      </div>

      {paletteOpen && hasSelection ? (
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          data-testid="trains-month-toolbar-palette-menu"
        >
          {paletteTemplates.map((template) => {
            const palette = TEMPLATE_PALETTE_STYLES[template];
            return (
              <button
                key={template}
                type="button"
                data-testid={`trains-month-paint-${template}`}
                onClick={() => handlePaletteClick(template)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors border-hq-border text-hq-fg hover:bg-hq-canvas hover:ring-1 ${palette.ring}`}
              >
                <TemplatePaletteBadge template={template} shape="square" />
                {templateLabels[template] ?? template}
              </button>
            );
          })}
        </div>
      ) : null}

      {pendingScopeTemplate &&
      (pendingScopeTemplate === "top_vs" || pendingScopeTemplate === "top_vr") ? (
        <div
          className="mt-2 overflow-hidden rounded-lg border border-hq-border bg-hq-surface"
          data-testid="trains-month-topn-scope"
        >
          <TopNScopePicker
            paintTemplate={pendingScopeTemplate}
            vrReporterCount={vrReporterCount}
            onBack={() => setPendingScopeTemplate(null)}
            onSelect={handleScopeSelect}
          />
        </div>
      ) : null}
    </div>
  );
}
