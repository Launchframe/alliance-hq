"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAppearance } from "@/components/appearance/AppearanceProvider";
import type { ResolvedAppearance } from "@/lib/appearance/appearance.shared";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const OPTIONS: Array<{
  value: ResolvedAppearance;
  icon: typeof Sun;
  labelKey: "appearanceLight" | "appearanceDark";
}> = [
  { value: "light", icon: Sun, labelKey: "appearanceLight" },
  { value: "dark", icon: Moon, labelKey: "appearanceDark" },
];

export function SidebarAppearanceToggle() {
  const t = useTranslations("shell");
  const { resolved, setPreference } = useAppearance();

  return (
    <div
      className="mb-3 grid grid-cols-2 gap-0.5 rounded-lg border border-hq-border bg-hq-canvas p-0.5"
      role="group"
      aria-label={t("appearanceLabel")}
      data-testid="sidebar-appearance-toggle"
    >
      {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
        const active = resolved === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => setPreference(value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-hq-surface text-hq-fg shadow-sm"
                : "text-hq-fg-muted hover:text-hq-fg",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
