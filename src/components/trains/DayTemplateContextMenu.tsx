"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { PAINT_TEMPLATES } from "@/components/trains/TrainMonthCalendar";
import { TemplatePaletteBadge } from "@/components/trains/TemplatePaletteBadge";
import type { WeekTemplateType } from "@/lib/trains/types";

export type DayTemplateMenuAnchor = {
  date: string;
  /** Preferred top-left in viewport coordinates (clientX/Y or rect). */
  x: number;
  y: number;
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

function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number } {
  const pad = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const vh = typeof window !== "undefined" ? window.innerHeight : 600;
  let left = x;
  let top = y;
  if (left + width > vw - pad) left = Math.max(pad, vw - width - pad);
  if (left < pad) left = pad;
  if (top + height > vh - pad) top = Math.max(pad, vh - height - pad);
  if (top < pad) top = pad;
  return { left, top };
}

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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !menuRef.current) {
      setPos(null);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    setPos(clampMenuPosition(anchor.x, anchor.y, rect.width, rect.height));
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

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
                onClose();
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
