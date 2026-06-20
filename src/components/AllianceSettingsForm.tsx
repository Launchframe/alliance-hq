"use client";

import { useTranslations } from "next-intl";

import { AllianceSeasonSettings } from "@/components/settings/AllianceSeasonSettings";
import { Link } from "@/i18n/navigation";

type Props = {
  allianceTag: string | null;
  showTeamLink?: boolean;
};

export function AllianceSettingsForm({
  allianceTag,
  showTeamLink = true,
}: Props) {
  const t = useTranslations("settings");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {allianceTag
            ? t("titleWithTag", { tag: allianceTag })
            : t("titleAlliance")}
        </h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitleAlliance")}</p>
      </div>

      <AllianceSeasonSettings />

      {showTeamLink ? (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="font-medium">{t("teamSectionTitle")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("teamSectionBody")}</p>
          <Link
            href="/settings/team"
            className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
          >
            {t("teamSectionLink")} →
          </Link>
        </section>
      ) : null}
    </div>
  );
}
