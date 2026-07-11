import "server-only";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { rbacAllowsAshedConnect, sessionHasActiveMembership } from "@/lib/native-alliance/access";
import { allianceSupportsHybridAshedPane } from "@/lib/nav/hybrid-ashed-pane.shared";
import { getRbacContext } from "@/lib/rbac/context";
import { getAshedConnection, loadSession } from "@/lib/session";

/**
 * Whether hybrid HQ+Ashed pages may show the Ashed pane for this session.
 * Requires session embed eligibility and a current HQ alliance linked to Ashed.
 */
export async function resolveCanUseAshedEmbedsForSession(
  sessionId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (!session) return false;

  const hqAllianceId = session.currentAllianceId;
  if (!hqAllianceId) return false;

  const [rbac, connection, hasActiveMembership, ashedAllianceId] =
    await Promise.all([
      getRbacContext(sessionId),
      getAshedConnection(sessionId),
      sessionHasActiveMembership(session),
      getAshedAllianceIdIfLinked(hqAllianceId),
    ]);

  if (!allianceSupportsHybridAshedPane(ashedAllianceId)) {
    return false;
  }

  return (
    Boolean(rbac?.isPlatformMaintainer) ||
    (connection !== null && rbacAllowsAshedConnect(rbac, hasActiveMembership))
  );
}
