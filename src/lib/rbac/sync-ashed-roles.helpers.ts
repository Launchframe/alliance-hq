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

export function normalizeAllianceTagForMatch(
  tag: string | null | undefined,
): string {
  return tag?.trim().toLowerCase() ?? "";
}

/** HQ shell rows created before Ashed connect (native provision, invite bootstrap). */
export function isUnlinkedHqAllianceShell(row: {
  ashedAllianceId: string | null;
}): boolean {
  return !row.ashedAllianceId?.trim();
}

/** Case-insensitive tag equality for native shell adoption (`findAdoptableHqAllianceShell`). */
export function allianceTagsMatchForShellAdoption(
  shellTag: string | null | undefined,
  ashedTag: string,
): boolean {
  const normalizedShell = normalizeAllianceTagForMatch(shellTag);
  const normalizedAshed = normalizeAllianceTagForMatch(ashedTag);
  return Boolean(normalizedShell && normalizedAshed && normalizedShell === normalizedAshed);
}
