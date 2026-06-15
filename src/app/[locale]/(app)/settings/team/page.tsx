import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { SettingsTeamClient } from "@/components/SettingsTeamClient";
import { sessionIsAllianceAdmin } from "@/lib/rbac/context";
import { getAllianceTeam } from "@/lib/rbac/sync-ashed-roles";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsTeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/team");
  const allowed = await sessionIsAllianceAdmin(session.id);
  if (!allowed) {
    redirect({ href: "/settings", locale });
  }

  const t = await getTranslations("team");
  const team = session.currentAllianceId
    ? await getAllianceTeam(session.currentAllianceId)
    : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[#58a6ff] hover:underline">
          ← {t("backToSettings")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("description")}</p>
      </div>

      <SettingsTeamClient initialTeam={team} />

      <p className="text-xs text-[#6e7681]">{t("ashedNote")}</p>
    </div>
  );
}
