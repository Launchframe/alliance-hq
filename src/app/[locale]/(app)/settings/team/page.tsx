import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { SettingsTeamClient } from "@/components/SettingsTeamClient";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getDb, schema } from "@/lib/db";
import { sessionHasActiveMembership } from "@/lib/native-alliance/access";
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
  const hasMembership = await sessionHasActiveMembership(session);
  if (!hasMembership) {
    redirect({ href: "/settings", locale });
  }

  const t = await getTranslations("team");
  const allianceId = resolveSessionAllianceId(session);
  const team = allianceId ? await getAllianceTeam(allianceId) : [];
  const canRefreshFromAshed = await sessionIsAllianceAdmin(session.id);

  let allianceTag = session.allianceTag;
  let allianceName: string | null = null;
  if (allianceId) {
    const db = getDb();
    const [alliance] = await db
      .select({
        tag: schema.alliances.tag,
        name: schema.alliances.name,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, allianceId))
      .limit(1);
    allianceTag = alliance?.tag ?? allianceTag;
    allianceName = alliance?.name ?? null;
  }

  const tagLabel = allianceTag ?? allianceName ?? t("unknownAlliance");

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[#58a6ff] hover:underline">
          ← {t("backToSettings")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">
          {t("titleWithTag", { tag: tagLabel })}
        </h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("description")}</p>
      </div>

      <SettingsTeamClient
        initialTeam={team}
        canRefreshFromAshed={canRefreshFromAshed}
      />

      {canRefreshFromAshed ? (
        <p className="text-xs text-[#6e7681]">{t("ashedNote")}</p>
      ) : null}
    </div>
  );
}
