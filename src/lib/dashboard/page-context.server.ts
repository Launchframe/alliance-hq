import "server-only";

import { rbacAllowsAshedConnect, sessionHasActiveMembership } from "@/lib/native-alliance/access";
import { getRbacContext } from "@/lib/rbac/context";
import { getAshedConnection, loadSession } from "@/lib/session";

export async function resolveCanUseAshedEmbedsForSession(
  sessionId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (!session) return false;

  const [rbac, connection, hasActiveMembership] = await Promise.all([
    getRbacContext(sessionId),
    getAshedConnection(sessionId),
    sessionHasActiveMembership(session),
  ]);

  return (
    Boolean(rbac?.isPlatformMaintainer) ||
    (connection !== null && rbacAllowsAshedConnect(rbac, hasActiveMembership))
  );
}
