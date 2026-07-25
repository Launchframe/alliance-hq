import { notFound } from "next/navigation";

import { OfficerActionItemsClient } from "@/components/officer-intel/OfficerActionItemsClient";
import { listOpenOfficerActionItems } from "@/lib/officer-intel/repository.server";
import {
  OFFICER_INTEL_READ_PERMISSION,
  OFFICER_INTEL_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ focus?: string }> };

export default async function OfficerActionItemsPage({ searchParams }: Props) {
  const { focus } = await searchParams;
  const session = await requirePageSession("/officer-intel/action-items");
  await requirePagePermission(session.id, OFFICER_INTEL_READ_PERMISSION);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const [items, canWrite] = await Promise.all([
    listOpenOfficerActionItems(allianceId),
    sessionHasPermission(session.id, OFFICER_INTEL_WRITE_PERMISSION),
  ]);

  return (
    <OfficerActionItemsClient
      initialItems={items}
      canWrite={canWrite}
      focusItemId={focus ?? null}
    />
  );
}
