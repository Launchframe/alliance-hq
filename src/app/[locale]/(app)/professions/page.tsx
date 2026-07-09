import { getTranslations } from "next-intl/server";

import { ProfessionsPage } from "@/components/professions/ProfessionsPage";
import { requirePageSession } from "@/lib/session";
import { resolveCommanderForHqUser } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("professions");
  return { title: t("title") };
}

export default async function ProfessionsRoute() {
  const session = await requirePageSession("/professions");
  const allianceId = session.currentAllianceId ?? session.allianceId ?? null;

  const commanderCtx = allianceId && session.hqUserId
    ? await resolveCommanderForHqUser(session.hqUserId, allianceId)
    : null;

  return (
    <ProfessionsPage
      allianceId={allianceId}
      commanderId={commanderCtx?.commanderId ?? null}
      profession={commanderCtx?.profession ?? null}
    />
  );
}
