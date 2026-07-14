"use client";

import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  TRAINS_DISPLAY_WEEK_STARTS,
  type TrainsDisplayWeekStartDow,
} from "@/lib/trains/trains-display-calendar.shared";
import {
  TRAINS_WHEEL_SPIN_SPEEDS,
  type TrainsWheelSpinSpeed,
} from "@/lib/trains/trains-wheel-speed.shared";

/** Deep-link target on `/settings/trains` (Price Is Freight section). */
export const TRAINS_ADVANCED_SETTINGS_HREF =
  "/settings/trains#price-is-freight" as const;

type Props = {
  displayWeekStartDow: TrainsDisplayWeekStartDow;
  wheelSpinSpeed: TrainsWheelSpinSpeed;
  canEdit: boolean;
  onPreferencesChange: (next: {
    displayWeekStartDow: TrainsDisplayWeekStartDow;
    wheelSpinSpeed: TrainsWheelSpinSpeed;
  }) => void;
  onError?: (message: string) => void;
};

export function TrainsUserSettingsMenu({
  displayWeekStartDow,
  wheelSpinSpeed,
  canEdit,
  onPreferencesChange,
  onError,
}: Props) {
  const t = useTranslations("trains.userSettings");
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    right: number;
    minWidth: number;
  } | null>(null);

  const updateMenuRect = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
      minWidth: Math.max(rect.width, 240),
    };
  }, []);

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`[data-trains-user-settings-menu="${menuId}"]`)
      ) {
        return;
      }
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, menuId, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const rect = updateMenuRect();
      if (rect) setMenuRect(rect);
    });

    function handleLayoutChange() {
      requestAnimationFrame(() => {
        const next = updateMenuRect();
        if (next) setMenuRect(next);
      });
    }

    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [open, updateMenuRect]);

  useEffect(() => {
    if (open) return;
    const frame = requestAnimationFrame(() => setMenuRect(null));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const patchPreferences = useCallback(
    async (patch: {
      displayWeekStartDow?: TrainsDisplayWeekStartDow;
      wheelSpinSpeed?: TrainsWheelSpinSpeed;
    }) => {
      if (!canEdit) return;
      setSaving(true);
      try {
        const res = await fetch("/api/settings/trains-preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = (await res.json()) as {
          displayWeekStartDow?: TrainsDisplayWeekStartDow;
          wheelSpinSpeed?: TrainsWheelSpinSpeed;
          error?: string;
        };
        if (!res.ok) {
          onError?.(body.error ?? t("saveFailed"));
          return;
        }
        onPreferencesChange({
          displayWeekStartDow:
            body.displayWeekStartDow ?? displayWeekStartDow,
          wheelSpinSpeed: body.wheelSpinSpeed ?? wheelSpinSpeed,
        });
      } catch (e) {
        onError?.(e instanceof Error ? e.message : t("saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [
      canEdit,
      displayWeekStartDow,
      onError,
      onPreferencesChange,
      t,
      wheelSpinSpeed,
    ],
  );

  const menu =
    open && menuRect
      ? createPortal(
          <div
            data-trains-user-settings-menu={menuId}
            role="menu"
            aria-label={t("menuLabel")}
            className="fixed z-[100] overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-3 shadow-lg"
            style={{
              top: menuRect.top,
              right: menuRect.right,
              minWidth: menuRect.minWidth,
            }}
          >
            <fieldset disabled={!canEdit || saving} className="space-y-4 border-0 p-0">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                {t("calendarWeekStart")}
              </legend>
              <div className="flex flex-col gap-1.5">
                {(
                  [
                    {
                      value: TRAINS_DISPLAY_WEEK_STARTS.sunday,
                      label: t("weekStartSunday"),
                    },
                    {
                      value: TRAINS_DISPLAY_WEEK_STARTS.monday,
                      label: t("weekStartMonday"),
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
                  >
                    <input
                      type="radio"
                      name={`${menuId}-week-start`}
                      className="accent-[#8957e5]"
                      checked={displayWeekStartDow === option.value}
                      onChange={() =>
                        void patchPreferences({
                          displayWeekStartDow: option.value,
                        })
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                  {t("wheelSpeed")}
                </p>
                <div className="flex flex-col gap-1.5">
                  {TRAINS_WHEEL_SPIN_SPEEDS.map((speed) => (
                    <label
                      key={speed}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
                    >
                      <input
                        type="radio"
                        name={`${menuId}-wheel-speed`}
                        className="accent-[#8957e5]"
                        checked={wheelSpinSpeed === speed}
                        onChange={() =>
                          void patchPreferences({ wheelSpinSpeed: speed })
                        }
                      />
                      {t(`wheelSpeed_${speed}`)}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            <div className="mt-3 border-t border-hq-border pt-3">
              <Link
                href={TRAINS_ADVANCED_SETTINGS_HREF}
                role="menuitem"
                onClick={closeMenu}
                className="block rounded-lg px-2 py-1.5 text-sm font-medium text-hq-accent hover:bg-hq-surface-muted hover:underline"
                data-testid="trains-advanced-settings-link"
              >
                {t("advancedSettings")}
              </Link>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div data-testid="trains-user-settings">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menuLabel")}
        disabled={!canEdit && !open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hq-border bg-hq-canvas text-hq-fg-muted hover:bg-hq-surface hover:text-hq-fg disabled:opacity-50"
      >
        <Settings2 className="h-4 w-4" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
