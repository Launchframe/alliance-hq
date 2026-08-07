import { sessionHasPermission } from "@/lib/rbac/context";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";
import { requirePageSession } from "@/lib/session";

import InboxPageClient from "./InboxPageClient";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("inbox");
  return await allianceScopedMetadata(t("title"));
}
export default async function InboxRoutePage() {
  const session = await requirePageSession("/inbox");
  const canManageRosterLinks = await sessionHasPermission(
    session.id,
    "members:write",
  );
  return <InboxPageClient showRosterLinkRequestsLink={canManageRosterLinks} />;
}
