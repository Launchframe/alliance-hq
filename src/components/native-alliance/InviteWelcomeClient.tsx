"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Props = {
  onConnectAshed: () => void;
};

export function InviteWelcomeClient({ onConnectAshed }: Props) {
  const t = useTranslations("invite.welcome");

  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-[#8b949e]">{t("body")}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConnectAshed}
          className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2.5 text-sm font-medium text-white sm:flex-1"
        >
          {t("connectAshed")}
        </button>
        <Link
          href="/members"
          className="inline-flex w-full items-center justify-center rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2.5 text-sm font-medium text-[#e6edf3] hover:bg-[#161b22] sm:flex-1"
        >
          {t("nativeOnly")}
        </Link>
      </div>
    </div>
  );
}
