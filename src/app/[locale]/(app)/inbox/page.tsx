import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";

import InboxPageClient from "./InboxPageClient";

export const dynamic = "force-dynamic";

export default async function InboxRoutePage() {
  const session = await requirePageSession("/inbox");
  const canManageRosterLinks = await sessionHasPermission(
    session.id,
    "members:write",
  );
  return <InboxPageClient showRosterLinkRequestsLink={canManageRosterLinks} />;
}
