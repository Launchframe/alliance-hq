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

import { PAINT_TEMPLATES } from "@/lib/trains/paint-templates.shared";
import { TemplatePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import { clampMenuPosition } from "@/lib/client/clamp-menu-position.shared";
import {
  focusMenuItem,
  getInitialMenuItemIndex,
  getMenuItems,
  menuKeyboardActionForKey,
  nextMenuItemIndex,
} from "@/lib/client/menu-keyboard-navigation.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

export type DayTemplateMenuAnchor = {
  date: string;
  /** Preferred top-left in viewport coordinates (clientX/Y or rect). */
  x: number;
  y: number;
  /** Restore focus to the day cell that opened the menu. */
  returnFocus?: () => void;
};

type Props = {
  open: boolean;
  anchor: DayTemplateMenuAnchor | null;
  currentTemplate: WeekTemplateType | null | undefined;
  templateLabels: Record<string, string>;
  onSelect: (template: WeekTemplateType) => void;
  onClose: () => void;
};

const MENU_MAX_HEIGHT =
  "min(20rem, calc(100dvh - 2rem))" as const;

export function DayTemplateContextMenu({
  open,
  anchor,
  currentTemplate,
  templateLabels,
  onSelect,
  onClose,
}: Props) {
  const t = useTranslations("trains.dayTemplateMenu");
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<(() => void) | null>(null);
  const activeIndexRef = useRef(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const closeMenu = useCallback(() => {
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
    const rect = menuRef.current.getBoundingClientRect();
    setPos(
      clampMenuPosition(anchor.x, anchor.y, rect.width, rect.height, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [open, anchor]);

  useEffect(() => {
    if (!open || !menuRef.current) return;

    const menu = menuRef.current;
    const items = getMenuItems(menu);
    const initialIndex = getInitialMenuItemIndex(items);
    activeIndexRef.current = focusMenuItem(items, initialIndex);

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menu.contains(target)) return;
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
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
  }, [closeMenu, open]);

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
      <div className="shrink-0 border-b border-hq-border px-3 py-2">
        <p className="text-xs font-medium text-hq-fg">{t("title")}</p>
        <p className="text-[10px] text-hq-fg-muted">{anchor.date}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        {PAINT_TEMPLATES.map((template) => {
          const selected = currentTemplate === template;
          return (
            <button
              key={template}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              data-testid={`trains-day-template-${template}`}
              onClick={() => {
                onSelect(template);
                closeMenu();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hq-canvas ${
                selected ? "bg-hq-canvas/80 text-hq-fg" : "text-hq-fg"
              }`}
            >
              <TemplatePaletteBadge template={template} shape="square" />
              <span className="min-w-0 flex-1 truncate">
                {templateLabels[template] ?? template}
              </span>
              {selected ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
