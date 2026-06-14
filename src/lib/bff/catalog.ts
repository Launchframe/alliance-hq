/** Phase 1 BFF allowlist — expand from docs/ashed-api-catalog.json as routes grow. */

type EntityOp = { entity: string; method: string; permission: string };

const ENTITY_OPS: EntityOp[] = [
  { entity: "Member", method: "GET", permission: "members:read" },
  { entity: "Alliance", method: "GET", permission: "alliance:read" },
  { entity: "DesertStormEvent", method: "GET", permission: "events:read" },
  { entity: "DesertStormScore", method: "GET", permission: "events:read" },
  { entity: "DesertStormScore", method: "POST", permission: "events:write" },
];

const INTEGRATION_OPS: Array<{ name: string; permission: string }> = [
  { name: "Core/UploadFile", permission: "upload:write" },
  {
    name: "Core/ExtractDataFromUploadedFile",
    permission: "upload:write",
  },
];

export function resolveEntityPermission(
  entity: string,
  method: string,
): string | null {
  const entry = ENTITY_OPS.find(
    (op) =>
      op.entity === entity &&
      op.method.toUpperCase() === method.toUpperCase(),
  );
  return entry?.permission ?? null;
}

export function resolveBulkPermission(entity: string): string | null {
  return resolveEntityPermission(entity, "POST");
}

export function resolveIntegrationPermission(action: string): string | null {
  return INTEGRATION_OPS.find((op) => op.name === action)?.permission ?? null;
}

/** Phase 1: allow all authenticated sessions with Ashed connection (RBAC in Phase 2). */
export function isAllowedPermission(_permission: string | null): boolean {
  return true;
}

export function decodeIntegrationAction(encoded: string): string {
  return encoded.replace(/--/g, "/");
}

export function encodeIntegrationAction(action: string): string {
  return action.replace(/\//g, "--");
}
