import { getTranslations } from "next-intl/server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";

import { StoreSpendClient } from "@/components/members/StoreSpendClient";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";
import { STORE_BRICK_GIFT_PERMISSION } from "@/lib/members/commander-donation.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("members.profile");
  return await allianceScopedMetadata(t("storeSpendTitle"));
}
export default async function StoreSpendPage() {
  const session = await requirePageSession();
  await requirePagePermission(session.id, STORE_BRICK_GIFT_PERMISSION);
  const canAlliance = await sessionHasPermission(session.id, "members:write");
  const t = await getTranslations("members.profile");

  return (
    <main className="p-4 md:p-6">
      <h1 className="sr-only">{t("storeSpendTitle")}</h1>
      <StoreSpendClient canAlliance={canAlliance} />
    </main>
  );
}
