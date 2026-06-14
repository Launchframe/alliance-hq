import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import type { AshedAllianceRow } from "@/lib/alliance/types";

/** Emails that should retain ashed-sourced alliance membership after sync. */
export function buildAllianceRosterEmails(
  ashedAlliance: Pick<AshedAllianceRow, "owner_email" | "collaborators">,
): Set<string> {
  const rosterEmails = new Set<string>();
  if (ashedAlliance.owner_email) {
    rosterEmails.add(normalizeAshedEmail(ashedAlliance.owner_email));
  }
  for (const email of ashedAlliance.collaborators ?? []) {
    rosterEmails.add(normalizeAshedEmail(email));
  }
  return rosterEmails;
}

/** Manual memberships are never revoked by Ashed sync. */
export function shouldRevokeAshedMembership(
  email: string,
  rosterEmails: Set<string>,
  source: string,
): boolean {
  return source === "ashed" && !rosterEmails.has(normalizeAshedEmail(email));
}
