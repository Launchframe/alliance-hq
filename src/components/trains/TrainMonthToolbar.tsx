"use client";

import {
  Crown,
  History,
  ImageDown,
  Lock,
  LockOpen,
  Palette,
  UserRoundPen,
  UserRoundX,
  Users,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { RulePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import { TopNScopePicker } from "@/components/trains/TopNScopePicker";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  DAY_RULE_PALETTE,
  RULE_PALETTE_SWATCHES,
  paletteEntryRequiresScope,
  ruleForPaletteSelection,
  type DayRulePaletteId,
} from "@/lib/trains/rules/palette.shared";

type Props = {
  selectedDates: string[];
  focusDate: string;
  today: string;
  hasConductor: boolean;
  locked: boolean;
  vipNeeded: boolean;
  canUnlock: boolean;
  canShareImage: boolean;
  canSpinSelected: boolean;
  spinDisabledReason?: string | null;
  ruleLabels: Record<DayRulePaletteId, string>;
  vrReporterCount: number;
  busy?: boolean;
  onPaint: (dates: string[], rule: ConductorRule | null) => void;
  onSpinSelected: () => void;
  onManualPick: () => void;
  onManualPickVip: () => void;
  onLockUnlock: () => void;
  onClearPending: () => void;
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
  vipNeeded,
  canUnlock,
  canShareImage,
  canSpinSelected,
  spinDisabledReason,
  ruleLabels,
  vrReporterCount,
  busy = false,
  onPaint,
  onSpinSelected,
  onManualPick,
  onManualPickVip,
  onLockUnlock,
  onClearPending,
  onShareImage,
  onViewHistory,
  onViewPool,
}: Props) {
  const t = useTranslations("trains.monthToolbar");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingScopeBoard, setPendingScopeBoard] = useState<
    "vs_top_n" | "vr_top_n" | null
  >(null);
  const [activePaletteId, setActivePaletteId] =
    useState<DayRulePaletteId | null>(null);

  const selectedCount = selectedDates.length;
  const hasSelection = selectedCount > 0;
  const singleDay = selectedCount === 1;

  const canManualPick = singleDay && !locked;
  const canManualPickVip = singleDay && locked && vipNeeded;
  const canClearPending = singleDay && hasConductor && !locked;
  const canLockUnlock =
    singleDay &&
    hasConductor &&
    (locked || focusDate <= today);
  const canHistory = singleDay && hasConductor;
  const canPool = singleDay;

  function handlePaletteClick(paletteId: DayRulePaletteId) {
    if (!hasSelection) return;
    // Scoped boards must pick a scope first — painting Top VS from the
    // toolbar can never fall back to a default scope.
    if (paletteEntryRequiresScope(paletteId)) {
      setPendingScopeBoard(paletteId as "vs_top_n" | "vr_top_n");
      return;
    }
    setActivePaletteId(paletteId);
    onPaint(selectedDates, ruleForPaletteSelection(paletteId));
    setPaletteOpen(false);
    setPendingScopeBoard(null);
  }

  function handleScopeSelect(topN: number) {
    if (!pendingScopeBoard || !hasSelection) return;
    setActivePaletteId(pendingScopeBoard);
    onPaint(selectedDates, ruleForPaletteSelection(pendingScopeBoard, topN));
    setPendingScopeBoard(null);
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
            active={paletteOpen || activePaletteId != null}
            testId="trains-month-toolbar-palette"
            onClick={() => setPaletteOpen((open) => !open)}
          >
            <Palette className="h-4 w-4" aria-hidden />
          </ToolbarIconButton>
          {activePaletteId ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-hq-border px-1.5 py-0.5 text-[10px] font-medium text-hq-fg-muted"
              data-testid="trains-month-toolbar-active-rule"
            >
              <RulePaletteBadge paletteId={activePaletteId} shape="square" />
              {ruleLabels[activePaletteId] ?? activePaletteId}
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
          label={t("manualPickVip")}
          disabled={!canManualPickVip}
          busy={busy}
          testId="trains-month-toolbar-manual-pick-vip"
          onClick={onManualPickVip}
        >
          <Crown className="h-4 w-4" aria-hidden />
        </ToolbarIconButton>

        <ToolbarIconButton
          label={
            locked
              ? canUnlock
                ? t("unlock")
                : t("requestUnlock")
              : t("lock")
          }
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
          label={t("clearPending")}
          disabled={!canClearPending}
          busy={busy}
          testId="trains-month-toolbar-clear-pending"
          onClick={onClearPending}
        >
          <UserRoundX className="h-4 w-4" aria-hidden />
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
          {DAY_RULE_PALETTE.map((entry) => {
            const palette = RULE_PALETTE_SWATCHES[entry.id];
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={`trains-month-paint-${entry.id}`}
                onClick={() => handlePaletteClick(entry.id)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors border-hq-border text-hq-fg hover:bg-hq-canvas hover:ring-1 ${palette.ring}`}
              >
                <RulePaletteBadge paletteId={entry.id} shape="square" />
                {ruleLabels[entry.id] ?? entry.id}
              </button>
            );
          })}
        </div>
      ) : null}

      {pendingScopeBoard ? (
        <div
          className="mt-2 overflow-hidden rounded-lg border border-hq-border bg-hq-surface"
          data-testid="trains-month-topn-scope"
        >
          <TopNScopePicker
            board={pendingScopeBoard}
            vrReporterCount={vrReporterCount}
            onBack={() => setPendingScopeBoard(null)}
            onSelect={handleScopeSelect}
          />
        </div>
      ) : null}
    </div>
  );
}
