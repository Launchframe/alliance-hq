"use client";

import { useTranslations } from "next-intl";

import { KbdCombo } from "@/components/ui/Kbd";
import { formatBindingLabels } from "@/lib/hotkeys/format";
import type { HotkeyBinding } from "@/lib/hotkeys/types";

type Props = {
  binding: HotkeyBinding;
  className?: string;
};

export function HotkeyBindingDisplay({ binding, className }: Props) {
  return <KbdCombo keys={formatBindingLabels(binding)} className={className} />;
}

export function useHotkeyCategoryLabel(category: string): string {
  const t = useTranslations("hotkeys.categories");
  switch (category) {
    case "global":
      return t("global");
    case "navigation":
      return t("navigation");
    case "admin":
      return t("admin");
    case "trains":
      return t("trains");
    case "tools":
      return t("tools");
    default:
      return category;
  }
}
