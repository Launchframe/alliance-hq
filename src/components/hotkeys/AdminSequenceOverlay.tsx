"use client";

import { useTranslations } from "next-intl";

import { useHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { ADMIN_LINKS } from "@/lib/admin/nav-links";
import { HotkeyBindingDisplay } from "@/components/hotkeys/hotkey-display";

export function AdminSequenceOverlay() {
  const t = useTranslations("hotkeys");
  const { adminSequenceMode, effectiveBindings } = useHotkeys();

  if (!adminSequenceMode) return null;

  const adminBindings = effectiveBindings.filter((entry) =>
    entry.actionId.startsWith("admin.nav."),
  );

  return (
    <div className="fixed bottom-4 left-1/2 z-[90] w-[min(96vw,42rem)] -translate-x-1/2 rounded-xl border border-[#388bfd]/40 bg-[#161b22]/95 p-4 shadow-xl backdrop-blur">
      <p className="text-sm font-medium text-[#e6edf3]">{t("adminSequenceTitle")}</p>
      <p className="mt-1 text-xs text-[#8b949e]">{t("adminSequenceDescription")}</p>
      <ul className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
        {adminBindings.map((entry) => {
          const adminLink = ADMIN_LINKS.find(
            (link) => `admin.nav.${link.labelKey}` === entry.actionId,
          );
          return (
            <li
              key={entry.actionId}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#30363d] px-3 py-2 text-xs"
            >
              <span className="truncate text-[#c9d1d9]">
                {adminLink
                  ? t(`actions.admin.${adminLink.labelKey}` as "actions.admin.overview")
                  : entry.actionId}
              </span>
              <HotkeyBindingDisplay binding={entry.binding} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
