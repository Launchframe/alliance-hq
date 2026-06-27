import { getTranslations } from "next-intl/server";

import { CommandersIndexView } from "@/components/commanders/CommandersIndexView";
import { loadCommanderIndex } from "@/lib/commanders/index.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("commandersIndex");
  return { title: t("title") };
}

export default async function CommandersIndexPage() {
  const session = await requirePageSession("/commanders");
  await requirePagePermission(session.id, "members:read", "/commanders");

  const initial = await loadCommanderIndex(session.id);

  return <CommandersIndexView initial={initial} />;
}
