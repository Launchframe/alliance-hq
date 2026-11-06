"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { TopNScopePicker } from "@/components/trains/TopNScopePicker";
import { RulePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import { clampMenuPosition } from "@/lib/client/clamp-menu-position.shared";
import {
  focusMenuItem,
  getInitialMenuItemIndex,
  getMenuItems,
  menuKeyboardActionForKey,
  nextMenuItemIndex,
} from "@/lib/client/menu-keyboard-navigation.shared";
import type { ConductorTopN } from "@/lib/trains/conductor-top-n.shared";
import {
  ruleLabelText,
  vipRuleIdentity,
  vipRuleLabelKey,
  vsMillionsToPoints,
  vsPointsToMillions,
  type ConductorRule,
  type VipRule,
} from "@/lib/trains/rules/catalog.shared";
import {
  DAY_RULE_PALETTE,
  paletteEntryOpensEventPicker,
  paletteEntryRequiresScope,
  paletteIdForRule,
  ruleForPaletteSelection,
  scopeForRule,
  type DayRulePaletteId,
} from "@/lib/trains/rules/palette.shared";

export type DayTemplateMenuAnchor = {
  date: string;
  /** Preferred top-left in viewport coordinates (clientX/Y or rect). */
  x: number;
  y: number;
  /** Restore focus to the day cell that opened the menu. */
  returnFocus?: () => void;
};

export type DayTemplatePaintSelection = {
  conductorRule: ConductorRule | null;
  vipRule: VipRule | null;
};

type MenuStep =
  | { kind: "conductor" }
  | { kind: "conductor_scope"; board: "vs_top_n" | "vr_top_n" }
  | { kind: "vip"; conductorRule: ConductorRule | null }
  | { kind: "vip_scope"; conductorRule: ConductorRule | null }
  | { kind: "vip_vs_min"; conductorRule: ConductorRule | null };

const VIP_CHOICES: Array<VipRule | null> = [
  null,
  { kind: "none" },
  { kind: "donations_second" },
];

type Props = {
  open: boolean;
  anchor: DayTemplateMenuAnchor | null;
  currentRule: ConductorRule | null;
  currentVipRule?: VipRule | null;
  ruleLabels: Record<DayRulePaletteId, string>;
  vrReporterCount?: number;
  onSelect: (selection: DayTemplatePaintSelection) => void;
  /**
   * Event results entries open the shared event rule picker.
   * `pendingConductorRule` seeds the picker when VIP event is chosen after a
   * conductor pick that has not been painted yet.
   */
  onConfigureEvent?: (
    date: string,
    options?: {
      role?: "conductor" | "vip";
      pendingConductorRule?: ConductorRule | null;
      /** Long-press wizard always paints conductor + VIP together. */
      paintBoth?: boolean;
    },
  ) => void;
  onClose: () => void;
};

const MENU_MAX_HEIGHT =
  "min(20rem, calc(100dvh - 2rem))" as const;

export function DayTemplateContextMenu({
  open,
  anchor,
  currentRule,
  currentVipRule = null,
  ruleLabels,
  vrReporterCount = 0,
  onSelect,
  onConfigureEvent,
  onClose,
}: Props) {
  const t = useTranslations("trains.dayTemplateMenu");
  const tRules = useTranslations("trains.rules");
  const tTopN = useTranslations("trains.topNScope");
  const tEventEvidence = useTranslations("eventEvidence");
  const locale = useLocale();
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<(() => void) | null>(null);
  const activeIndexRef = useRef(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [step, setStep] = useState<MenuStep>({ kind: "conductor" });
  const [vsMinScoreInput, setVsMinScoreInput] = useState(
    currentVipRule?.kind === "vs_min_score"
      ? String(currentVipRule.minScore / 1_000_000)
      : "",
  );

  const finish = useCallback(
    (selection: DayTemplatePaintSelection) => {
      onSelect(selection);
      setStep({ kind: "conductor" });
      onClose();
      returnFocusRef.current?.();
      returnFocusRef.current = null;
    },
    [onClose, onSelect],
  );

  const closeMenu = useCallback(() => {
    setStep({ kind: "conductor" });
    onClose();
    returnFocusRef.current?.();
    returnFocusRef.current = null;
  }, [onClose]);

  const advanceToVip = useCallback((conductorRule: ConductorRule | null) => {
    setStep({ kind: "vip", conductorRule });
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchor || !menuRef.current) {
      setPos(null);
      return;
    }
    returnFocusRef.current = anchor.returnFocus ?? null;
    const menu = menuRef.current;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    setPos(
      clampMenuPosition(anchor.x, anchor.y, width, height, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [open, anchor, step]);

  useEffect(() => {
    if (!open || !pos || !menuRef.current) return;

    const menu = menuRef.current;
    const items = getMenuItems(menu);
    const initialIndex = getInitialMenuItemIndex(items);
    activeIndexRef.current = focusMenuItem(items, initialIndex);

    const ignoreOutsideUntil = performance.now() + 750;

    function handlePointerDown(event: PointerEvent) {
      if (performance.now() < ignoreOutsideUntil) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menu.contains(target)) return;
      // Outside click after a conductor was chosen finishes with Free Choice VIP.
      if (step.kind === "vip" || step.kind === "vip_scope" || step.kind === "vip_vs_min") {
        finish({ conductorRule: step.conductorRule, vipRule: null });
        return;
      }
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (step.kind === "conductor_scope") {
          setStep({ kind: "conductor" });
          return;
        }
        if (step.kind === "vip_scope" || step.kind === "vip_vs_min") {
          setStep({ kind: "vip", conductorRule: step.conductorRule });
          return;
        }
        if (step.kind === "vip") {
          setStep({ kind: "conductor" });
          return;
        }
        closeMenu();
        return;
      }

      const menuItems = getMenuItems(menu);
      if (menuItems.length === 0) return;

      const action = menuKeyboardActionForKey(event.key);
      if (!action) return;

      if (action === "tab-forward" || action === "tab-backward") {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const currentIndex = menuItems.findIndex(
          (item) => item === document.activeElement,
        );
        const startIndex = currentIndex >= 0 ? currentIndex : activeIndexRef.current;
        const nextIndex = nextMenuItemIndex(
          menuItems,
          startIndex,
          event.shiftKey ? "tab-backward" : "tab-forward",
        );
        activeIndexRef.current = focusMenuItem(menuItems, nextIndex);
        return;
      }

      event.preventDefault();
      const currentIndex = menuItems.findIndex(
        (item) => item === document.activeElement,
      );
      const startIndex = currentIndex >= 0 ? currentIndex : activeIndexRef.current;
      activeIndexRef.current = focusMenuItem(
        menuItems,
        nextMenuItemIndex(menuItems, startIndex, action),
      );
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, finish, open, pos, step]);

  if (!open || !anchor || typeof document === "undefined") return null;

  const vipConductorRule =
    step.kind === "vip" || step.kind === "vip_scope" || step.kind === "vip_vs_min"
      ? step.conductorRule
      : null;

  const headerTitle =
    step.kind === "vip" || step.kind === "vip_scope" || step.kind === "vip_vs_min"
      ? t("vipStepTitle")
      : t("title");

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t("ariaLabel", { date: anchor.date })}
      data-testid="trains-day-template-menu"
      data-step={step.kind}
      style={{
        position: "fixed",
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        maxHeight: MENU_MAX_HEIGHT,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[80] flex w-[min(18rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-hq-border bg-hq-surface shadow-lg"
    >
      {step.kind === "conductor_scope" ? (
        <TopNScopePicker
          board={step.board}
          vrReporterCount={vrReporterCount}
          onBack={() => setStep({ kind: "conductor" })}
          onSelect={(topN: ConductorTopN) => {
            advanceToVip(ruleForPaletteSelection(step.board, topN));
          }}
        />
      ) : step.kind === "vip_scope" ? (
        <TopNScopePicker
          board="vs_top_n"
          vrReporterCount={vrReporterCount}
          onBack={() =>
            setStep({ kind: "vip", conductorRule: step.conductorRule })
          }
          onSelect={(topN: ConductorTopN) => {
            if (topN === 1 || topN === 3 || topN === 5 || topN === 10) {
              finish({
                conductorRule: step.conductorRule,
                vipRule: { kind: "vs_top_n", topN },
              });
            }
          }}
        />
      ) : (
        <>
          <div className="shrink-0 border-b border-hq-border px-3 py-2">
            <p className="text-xs font-medium text-hq-fg">{headerTitle}</p>
            <p className="text-[10px] text-hq-fg-muted">{anchor.date}</p>
          </div>
          {step.kind === "conductor" ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {DAY_RULE_PALETTE.map((entry) => {
                const selected = paletteIdForRule(currentRule) === entry.id;
                const currentScope = selected ? scopeForRule(currentRule) : null;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-testid={`trains-day-rule-${entry.id}`}
                    onClick={() => {
                      if (paletteEntryRequiresScope(entry.id)) {
                        setStep({
                          kind: "conductor_scope",
                          board: entry.id as "vs_top_n" | "vr_top_n",
                        });
                        return;
                      }
                      if (paletteEntryOpensEventPicker(entry.id)) {
                        const date = anchor.date;
                        closeMenu();
                        onConfigureEvent?.(date, {
                          role: "conductor",
                          paintBoth: true,
                        });
                        return;
                      }
                      advanceToVip(ruleForPaletteSelection(entry.id));
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hq-canvas ${
                      selected ? "bg-hq-canvas/80 text-hq-fg" : "text-hq-fg"
                    }`}
                  >
                    <RulePaletteBadge paletteId={entry.id} shape="square" />
                    <span className="min-w-0 flex-1 truncate">
                      {ruleLabels[entry.id] ?? entry.id}
                      {currentScope != null ? ` · ${currentScope}` : ""}
                    </span>
                    {selected ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-cyan-400"
                        aria-hidden
                      />
                    ) : (
                      <span className="w-3.5 shrink-0" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ) : step.kind === "vip" || step.kind === "vip_vs_min" ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {VIP_CHOICES.map((rule) => {
                  const selected =
                    step.kind === "vip" &&
                    vipRuleIdentity(currentVipRule) === vipRuleIdentity(rule);
                  return (
                    <button
                      key={vipRuleIdentity(rule)}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      data-testid={`trains-day-vip-${vipRuleIdentity(rule)}`}
                      onClick={() =>
                        finish({
                          conductorRule: vipConductorRule,
                          vipRule: rule,
                        })
                      }
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hq-canvas ${
                        selected ? "bg-hq-canvas/80 text-hq-fg" : "text-hq-fg"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {ruleLabelText(
                          vipRuleLabelKey(rule),
                          tRules,
                          tEventEvidence,
                        )}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={currentVipRule?.kind === "vs_top_n"}
                  data-testid="trains-day-vip-vs_top_n"
                  onClick={() =>
                    setStep({
                      kind: "vip_scope",
                      conductorRule: vipConductorRule,
                    })
                  }
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-canvas"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {currentVipRule?.kind === "vs_top_n"
                      ? `${tRules("vsTopN")} · ${tTopN("scopeLabel", { count: currentVipRule.topN })}`
                      : tRules("vsTopN")}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={step.kind === "vip_vs_min"}
                  data-testid="trains-day-vip-vs_min_score"
                  onClick={() =>
                    setStep({
                      kind: "vip_vs_min",
                      conductorRule: vipConductorRule,
                    })
                  }
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-canvas"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {tRules("vipVsMinScore")}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="trains-day-vip-event_scores"
                  onClick={() => {
                    const date = anchor.date;
                    const conductorRule = vipConductorRule;
                    closeMenu();
                    onConfigureEvent?.(date, {
                      role: "vip",
                      pendingConductorRule: conductorRule,
                      paintBoth: true,
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-canvas"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {tEventEvidence("title")}
                  </span>
                </button>
                {step.kind === "vip_vs_min" ? (
                  <div className="border-t border-hq-border px-3 py-2">
                    <label
                      htmlFor="trains-day-menu-vip-vs-min"
                      className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted"
                    >
                      {t("vipVsMinScoreLabel")}
                    </label>
                    <input
                      id="trains-day-menu-vip-vs-min"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={vsMinScoreInput}
                      placeholder={t("vipVsMinScorePlaceholder")}
                      onChange={(event) => setVsMinScoreInput(event.target.value)}
                      data-testid="trains-day-menu-vip-vs-min-score-input"
                      className="mt-1.5 w-full rounded-md border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm text-hq-fg focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      data-testid="trains-day-vip-vs-min-apply"
                      disabled={vsMillionsToPoints(vsMinScoreInput) == null}
                      onClick={() => {
                        const points = vsMillionsToPoints(vsMinScoreInput);
                        if (points == null) return;
                        finish({
                          conductorRule: vipConductorRule,
                          vipRule: { kind: "vs_min_score", minScore: points },
                        });
                      }}
                      className="mt-2 w-full rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
                    >
                      {vsMillionsToPoints(vsMinScoreInput) != null
                        ? tRules("vipVsMinScoreValue", {
                            score: vsPointsToMillions(
                              vsMillionsToPoints(vsMinScoreInput)!,
                              locale,
                            ),
                          })
                        : t("vipVsMinScoreApply")}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 border-t border-hq-border p-2">
                <button
                  type="button"
                  data-testid="trains-day-vip-cancel-free-choice"
                  onClick={() =>
                    finish({
                      conductorRule: vipConductorRule,
                      vipRule: null,
                    })
                  }
                  className="w-full rounded-md border border-hq-border px-3 py-1.5 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
                >
                  {t("vipStepCancel")}
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}
