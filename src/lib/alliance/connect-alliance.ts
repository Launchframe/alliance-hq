import {
  base44ListAlliances,
  type AshedAlliance,
} from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";

import {
  AllianceSelectionError,
  filterAccessibleAlliances,
  resolveSelectedAccessibleAlliance,
  type AllianceSelectionInput,
} from "./accessible";
import type { AshedUserRef, AccessibleAlliance } from "./types";

export type ConnectAllianceResult = AccessibleAlliance;

export async function listAccessibleAlliances(
  connection: ParsedConnection,
  user: AshedUserRef,
): Promise<AccessibleAlliance[]> {
  const alliances = await base44ListAlliances(connection);
  return filterAccessibleAlliances(alliances as AshedAlliance[], user);
}

export async function resolveConnectAlliance(
  connection: ParsedConnection,
  user: AshedUserRef,
  selection?: AllianceSelectionInput,
): Promise<ConnectAllianceResult> {
  const accessible = await listAccessibleAlliances(connection, user);
  return resolveSelectedAccessibleAlliance(accessible, selection);
}

export function allianceSelectionErrorStatus(code: AllianceSelectionError["code"]) {
  switch (code) {
    case "none_accessible":
      return 403;
    case "ambiguous":
      return 400;
    case "not_accessible":
    case "not_found":
      return 400;
    default:
      return 400;
  }
}

export { AllianceSelectionError };
