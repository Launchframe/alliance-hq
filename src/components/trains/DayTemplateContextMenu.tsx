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
import { useTranslations } from "next-intl";

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
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  DAY_RULE_PALETTE,
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
  rule: ConductorRule | null;
};

type Props = {
  open: boolean;
  anchor: DayTemplateMenuAnchor | null;
  currentRule: ConductorRule | null;
  ruleLabels: Record<DayRulePaletteId, string>;
  vrReporterCount?: number;
  onSelect: (selection: DayTemplatePaintSelection) => void;
  onClose: () => void;
};

const MENU_MAX_HEIGHT =
  "min(20rem, calc(100dvh - 2rem))" as const;

export function DayTemplateContextMenu({
  open,
  anchor,
  currentRule,
  ruleLabels,
  vrReporterCount = 0,
  onSelect,
  onClose,
}: Props) {
  const t = useTranslations("trains.dayTemplateMenu");
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<(() => void) | null>(null);
  const activeIndexRef = useRef(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [scopeBoard, setScopeBoard] = useState<
    "vs_top_n" | "vr_top_n" | null
  >(null);

  const closeMenu = useCallback(() => {
    setScopeBoard(null);
    onClose();
    returnFocusRef.current?.();
    returnFocusRef.current = null;
  }, [onClose]);

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
  }, [open, anchor, scopeBoard]);

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
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (scopeBoard) {
          setScopeBoard(null);
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
  }, [closeMenu, open, pos, scopeBoard]);

  if (!open || !anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t("ariaLabel", { date: anchor.date })}
      data-testid="trains-day-template-menu"
      style={{
        position: "fixed",
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        maxHeight: MENU_MAX_HEIGHT,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[80] flex w-[min(18rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-hq-border bg-hq-surface shadow-lg"
    >
      {scopeBoard ? (
        <TopNScopePicker
          board={scopeBoard}
          vrReporterCount={vrReporterCount}
          onBack={() => setScopeBoard(null)}
          onSelect={(topN: ConductorTopN) => {
            onSelect({ rule: ruleForPaletteSelection(scopeBoard, topN) });
            closeMenu();
          }}
        />
      ) : (
        <>
          <div className="shrink-0 border-b border-hq-border px-3 py-2">
            <p className="text-xs font-medium text-hq-fg">{t("title")}</p>
            <p className="text-[10px] text-hq-fg-muted">{anchor.date}</p>
          </div>
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
                    // Scoped boards always open the scope list, so a paint can
                    // never be sent with a defaulted or missing scope.
                    if (paletteEntryRequiresScope(entry.id)) {
                      setScopeBoard(entry.id as "vs_top_n" | "vr_top_n");
                      return;
                    }
                    onSelect({ rule: ruleForPaletteSelection(entry.id) });
                    closeMenu();
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
        </>
      )}
    </div>,
    document.body,
  );
}
