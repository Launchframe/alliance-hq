"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  markAshedShellConnectDismissed,
  readAshedShellConnectDismissed,
  subscribeAshedShellConnectDismissed,
} from "@/lib/connect/ashed-shell-prompts.shared";

type Props = {
  show: boolean;
};

export function ConnectAshedBanner({ show }: Props) {
  const t = useTranslations("onboard");
  const dismissed = useSyncExternalStore(
    subscribeAshedShellConnectDismissed,
    readAshedShellConnectDismissed,
    () => false,
  );

  if (!show || dismissed) return null;

  function dismiss() {
    markAshedShellConnectDismissed();
  }

  return (
    <div className="border-b border-[#30363d] bg-[#161b22]/95 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[#c9d1d9]">{t("connectAshedBanner")}</p>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/connect"
            className="rounded-md border border-[#388bfd] bg-[#388bfd] px-3 py-1.5 text-xs font-medium text-white"
          >
            {t("connectAshedCta")}
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3]"
          >
            {t("connectAshedDismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
