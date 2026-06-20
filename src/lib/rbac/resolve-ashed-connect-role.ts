import type { AllianceAccessRole } from "@/lib/alliance/types";

import type { SystemRoleName } from "./constants";

/**
 * HQ role granted to the connecting user on Ashed connect (not roster bulk sync).
 * Caps owner elevation when the alliance already has an HQ owner.
 */
export function resolveAshedConnectRole(input: {
  wasAllianceCreated: boolean;
  allianceHasOwner: boolean;
  ashedAccessRole: AllianceAccessRole | null;
}): SystemRoleName {
  const { wasAllianceCreated, allianceHasOwner, ashedAccessRole } = input;

  if (wasAllianceCreated && !allianceHasOwner) {
    if (ashedAccessRole === "owner") {
      return "owner";
    }
    if (ashedAccessRole === "maintainer") {
      return "officer";
    }
    return "member";
  }

  if (allianceHasOwner) {
    if (ashedAccessRole === "owner" || ashedAccessRole === "maintainer") {
      return "officer";
    }
    return "member";
  }

  if (ashedAccessRole === "owner") {
    return "owner";
  }
  if (ashedAccessRole === "maintainer") {
    return "officer";
  }
  return "member";
}
