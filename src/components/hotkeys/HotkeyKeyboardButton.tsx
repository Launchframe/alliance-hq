"use client";

import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";

import { useHotkeys } from "@/components/hotkeys/HotkeyProvider";

export function HotkeyKeyboardButton() {
  const t = useTranslations("hotkeys");
  const { openPalette } = useHotkeys();

  return (
    <button
      type="button"
      onClick={openPalette}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-hq-border text-hq-fg-muted transition-colors hover:bg-hq-surface-muted hover:text-hq-fg"
      aria-label={t("openPalette")}
    >
      <Keyboard className="h-4 w-4" aria-hidden />
    </button>
  );
}
