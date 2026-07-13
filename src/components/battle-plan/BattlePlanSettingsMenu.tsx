"use client";

import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import type {
  CapturePolicy,
  SerializedBattlePlanSettings,
} from "@/lib/battle-plan/types.shared";

const CAPTURE_POLICY_OPTIONS = ["peace", "war"] as const satisfies readonly CapturePolicy[];

type Props = {
  settings: SerializedBattlePlanSettings;
  canWrite: boolean;
  saving: boolean;
  onSaveSettings: (input: {
    defaultCapturePolicy: CapturePolicy;
  }) => Promise<void>;
};

export function BattlePlanSettingsMenu({
  settings,
  canWrite,
  saving,
  onSaveSettings,
}: Props) {
  const t = useTranslations("battlePlan.settings");
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
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
      minWidth: Math.max(rect.width, 280),
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
        target.closest(`[data-battle-plan-settings-menu="${menuId}"]`)
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

  const policyLabel = (policy: CapturePolicy) =>
    policy === "peace" ? t("policyPeace") : t("policyWar");

  const menu =
    open && menuRect
      ? createPortal(
          <div
            data-battle-plan-settings-menu={menuId}
            role="menu"
            aria-label={t("menuLabel")}
            className="fixed z-[100] overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-3 shadow-lg"
            style={{
              top: menuRect.top,
              right: menuRect.right,
              minWidth: menuRect.minWidth,
            }}
          >
            <fieldset disabled={!canWrite || saving} className="space-y-3 border-0 p-0">
              <legend className="text-sm font-semibold text-hq-fg">{t("title")}</legend>
              <p className="text-xs text-hq-fg-muted">{t("subtitle")}</p>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                  {t("defaultPolicy")}
                </p>
                <div className="flex flex-col gap-1.5">
                  {CAPTURE_POLICY_OPTIONS.map((policy) => (
                    <label
                      key={policy}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
                    >
                      <input
                        type="radio"
                        name={`${menuId}-capture-policy`}
                        className="accent-[#8957e5]"
                        checked={settings.defaultCapturePolicy === policy}
                        onChange={() => {
                          if (
                            !canWrite ||
                            saving ||
                            settings.defaultCapturePolicy === policy
                          ) {
                            return;
                          }
                          void onSaveSettings({ defaultCapturePolicy: policy });
                        }}
                      />
                      {policyLabel(policy)}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>
          </div>,
          document.body,
        )
      : null;

  return (
    <div data-testid="battle-plan-settings">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menuLabel")}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hq-border bg-hq-canvas text-hq-fg-muted hover:bg-hq-surface hover:text-hq-fg"
      >
        <Settings2 className="h-4 w-4" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
