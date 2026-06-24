"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Props = {
  tag: string;
  name?: string | null;
  stale?: boolean;
};

export function RosterAllianceBanner({ tag, name, stale }: Props) {
  const t = useTranslations("videoReview");

  const label = name?.trim()
    ? t("rosterAllianceTargetNamed", { tag, name })
    : t("rosterAllianceTarget", { tag });

  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        stale
          ? "border-[#d29922]/50 bg-[#d29922]/10"
          : "border-[#388bfd]/40 bg-[#388bfd]/10"
      }`}
    >
      <p className="font-medium text-[#e6edf3]">{label}</p>
      <p className="mt-1 text-[#8b949e]">{t("rosterAllianceHint")}</p>
      {stale ? (
        <p className="mt-2 text-[#e3b341]">{t("rosterAllianceStale")}</p>
      ) : null}
      <Link
        href="/settings"
        className="mt-2 inline-block text-[#58a6ff] hover:underline"
      >
        {t("rosterAllianceSettingsLink")}
      </Link>
    </div>
  );
}
