import "server-only";

import { auth } from "@/lib/auth";
import { loadSession, readSessionId } from "@/lib/session";

/**
 * True when the visitor has either a NextAuth user or an HQ browser session
 * bound to an HQ user (legacy bootstrap-only officers may lack NextAuth).
 */
export async function hasSignedInAppSession(): Promise<boolean> {
  try {
    const nextAuthSession = await auth();
    if (nextAuthSession?.user?.id?.trim()) {
      return true;
    }
  } catch {
    // Fall through to HQ session probe.
  }

  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return false;
    }
    const session = await loadSession(sessionId);
    return Boolean(session?.hqUserId?.trim());
  } catch {
    return false;
  }
}
