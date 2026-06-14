import type { SystemRoleName } from "@/lib/rbac/constants";

import type {
  AccessibleAlliance,
  AllianceAccessRole,
  AshedAllianceRow,
  AshedUserRef,
} from "./types";

export class AllianceSelectionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "none_accessible"
      | "ambiguous"
      | "not_accessible"
      | "not_found",
  ) {
    super(message);
    this.name = "AllianceSelectionError";
  }
}

export function normalizeAshedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function userAllianceAccessRole(
  alliance: AshedAllianceRow,
  user: AshedUserRef,
): AllianceAccessRole | null {
  const normalized = normalizeAshedEmail(user.email);
  const ownerEmail = alliance.owner_email
    ? normalizeAshedEmail(alliance.owner_email)
    : null;

  if (
    (ownerEmail && normalized === ownerEmail) ||
    (alliance.owner_id && user.id && alliance.owner_id === user.id)
  ) {
    return "owner";
  }

  const collaborators = (alliance.collaborators ?? []).map(normalizeAshedEmail);
  if (collaborators.includes(normalized)) {
    return "maintainer";
  }

  return null;
}

export function filterAccessibleAlliances(
  alliances: AshedAllianceRow[],
  user: AshedUserRef,
): AccessibleAlliance[] {
  const accessible: AccessibleAlliance[] = [];

  for (const alliance of alliances) {
    if (!alliance.id || !alliance.tag?.trim()) {
      continue;
    }

    const accessRole = userAllianceAccessRole(alliance, user);
    if (!accessRole) {
      continue;
    }

    accessible.push({
      id: alliance.id,
      tag: alliance.tag.trim(),
      name: alliance.name,
      accessRole,
    });
  }

  return accessible.sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
  );
}

export type AllianceSelectionInput = {
  allianceId?: string;
  allianceTag?: string;
};

export function resolveSelectedAccessibleAlliance(
  accessible: AccessibleAlliance[],
  selection?: AllianceSelectionInput,
): AccessibleAlliance {
  if (accessible.length === 0) {
    throw new AllianceSelectionError(
      "No alliance admin access found on Ashed. You must be the alliance owner or a collaborator.",
      "none_accessible",
    );
  }

  if (selection?.allianceId) {
    const match = accessible.find((row) => row.id === selection.allianceId);
    if (!match) {
      throw new AllianceSelectionError(
        "Selected alliance is not accessible with this Ashed account.",
        "not_accessible",
      );
    }
    return match;
  }

  if (selection?.allianceTag?.trim()) {
    const needle = selection.allianceTag.trim().toLowerCase();
    const match = accessible.find(
      (row) => row.tag.trim().toLowerCase() === needle,
    );
    if (!match) {
      throw new AllianceSelectionError(
        `Alliance "${selection.allianceTag.trim()}" is not accessible with this Ashed account.`,
        "not_accessible",
      );
    }
    return match;
  }

  if (accessible.length === 1) {
    return accessible[0];
  }

  throw new AllianceSelectionError(
    "Multiple alliances available — select one to continue.",
    "ambiguous",
  );
}

export function accessRoleToSystemRole(
  accessRole: AllianceAccessRole,
): SystemRoleName {
  return accessRole === "owner" ? "owner" : "maintainer";
}

/** Maps any user on a known alliance row to HQ system role (includes viewer fallback). */
export function resolveSystemRoleForAlliance(
  alliance: AshedAllianceRow,
  user: AshedUserRef,
): SystemRoleName {
  const accessRole = userAllianceAccessRole(alliance, user);
  if (accessRole) {
    return accessRoleToSystemRole(accessRole);
  }
  return "viewer";
}
