"use client";

import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { AllianceSafeTimeSettingsField } from "@/components/alliance/AllianceSafeTimeSettingsField";
import type { AllianceSafeTimeSlot } from "@/lib/alliance/alliance-safe-time.shared";

type Props = {
  allianceTag: string | null;
  allianceSafeTimeSlot: AllianceSafeTimeSlot | null;
  canWrite: boolean;
  onSaved: (slot: AllianceSafeTimeSlot) => void;
  onError?: (message: string) => void;
  /** When set, opening the menu is triggered externally (e.g. setup banner CTA). */
  openRequestToken?: number;
};

export function BankManagementSettingsMenu({
  allianceTag,
  allianceSafeTimeSlot,
  canWrite,
  onSaved,
  onError,
  openRequestToken,
}: Props) {
  const t = useTranslations("bankManagement.settings");
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<AllianceSafeTimeSlot | null>(null);
  const lastOpenTokenRef = useRef(0);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    right: number;
    minWidth: number;
  } | null>(null);

  const displaySlot = pendingSlot ?? allianceSafeTimeSlot;

  useEffect(() => {
    if (openRequestToken == null || openRequestToken <= lastOpenTokenRef.current) {
      return;
    }
    lastOpenTokenRef.current = openRequestToken;
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [openRequestToken]);

  const updateMenuRect = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
      minWidth: Math.max(rect.width, 300),
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
        target.closest(`[data-bank-settings-menu="${menuId}"]`)
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

  const saveSlot = async (next: AllianceSafeTimeSlot) => {
    if (!allianceTag || !canWrite || saving) return;
    setSaving(true);
    setPendingSlot(next);
    try {
      const response = await fetch(`/api/alliance/${encodeURIComponent(allianceTag)}/safe-time`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allianceSafeTimeSlot: next }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        onError?.(data?.error ?? t("saveFailed"));
        setPendingSlot(null);
        return;
      }
      setPendingSlot(null);
      onSaved(next);
    } catch {
      onError?.(t("saveFailed"));
      setPendingSlot(null);
    } finally {
      setSaving(false);
    }
  };

  const menu =
    open && menuRect
      ? createPortal(
          <div
            data-bank-settings-menu={menuId}
            role="menu"
            aria-label={t("menuLabel")}
            className="fixed z-[100] overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-3 shadow-lg"
            style={{
              top: menuRect.top,
              right: menuRect.right,
              minWidth: menuRect.minWidth,
            }}
          >
            <AllianceSafeTimeSettingsField
              value={displaySlot}
              disabled={!canWrite}
              saving={saving}
              onChange={(next) => void saveSlot(next)}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <div data-testid="bank-management-settings">
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
