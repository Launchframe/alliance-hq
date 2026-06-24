import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { SettingsTeamClient } from "@/components/SettingsTeamClient";
import { TeamInvitePanel } from "@/components/settings/TeamInvitePanel";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { canRefreshRosterFromAshed } from "@/lib/connect/ashed-shell-prompts.shared";
import { getDb, schema } from "@/lib/db";
import {
  assignableInviteRolesForContext,
  canManageTeamInvites,
} from "@/lib/native-alliance/team-invites.server";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { getRbacContext, sessionIsAllianceAdmin } from "@/lib/rbac/context";
import { getAllianceTeam } from "@/lib/rbac/sync-ashed-roles";
import { getAshedConnection, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsTeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/team");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const t = await getTranslations("team");
  if (access.allianceId === null) {
    redirect({ href: "/settings", locale });
    throw new Error("Alliance context required.");
  }
  const allianceId = access.allianceId;

  const team = await getAllianceTeam(allianceId);
  const rbac = await getRbacContext(access.session.id);
  const isAllianceAdmin = await sessionIsAllianceAdmin(access.session.id);
  const operatingMode = await getAllianceOperatingMode(allianceId);
  const ashedConnection = await getAshedConnection(access.session.id);
  const canRefreshFromAshed =
    isAllianceAdmin &&
    canRefreshRosterFromAshed({
      operatingMode,
      isAshedConnected: ashedConnection !== null,
    });
  const canManageInvites = rbac ? canManageTeamInvites(rbac) : false;
  const assignableInviteRoles = rbac ? assignableInviteRolesForContext(rbac) : [];
  const gameServerNumber = await resolveAllianceGameServerNumber(allianceId);

  let allianceTag = access.session.allianceTag;
  let allianceName: string | null = null;
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

      {canManageInvites ? (
        <TeamInvitePanel
          assignableRoles={assignableInviteRoles}
          gameServerNumber={gameServerNumber}
          allianceTag={allianceTag ?? ""}
        />
      ) : null}

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
