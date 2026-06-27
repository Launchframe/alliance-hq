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
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#30363d] text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3]"
      aria-label={t("openPalette")}
    >
      <Keyboard className="h-4 w-4" aria-hidden />
    </button>
  );
}
