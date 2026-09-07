import { getTranslations } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { AllianceRegularEventsSettings } from "@/components/settings/AllianceRegularEventsSettings";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { getRbacContext } from "@/lib/rbac/context";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { requirePageSession } from "@/lib/session";
import { resolveAllianceTagForSession } from "@/lib/settings/alliance-settings-access.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("settings.regularEvents");
  return await allianceScopedMetadata(t("title"));
}

export default async function RegularEventsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/regular-events");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const rbac = await getRbacContext(access.session.id);
  if (!rbac?.permissions.has("scores:read")) {
    redirect({ href: "/settings", locale });
    throw new Error("Forbidden");
  }

  const allianceTag = await resolveAllianceTagForSession(access.session);
  if (!allianceTag) {
    redirect({ href: "/settings", locale });
    throw new Error("Missing alliance");
  }

  const tSettings = await getTranslations("settings");

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-hq-accent hover:underline">
          ← {tSettings("backToAllianceSettings")}
        </Link>
      </div>
      <AllianceRegularEventsSettings allianceTag={allianceTag} />
    </div>
  );
}
