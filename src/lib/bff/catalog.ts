/** BFF allowlist — expand from docs/ashed-api-catalog.json as routes grow. */

type EntityOp = { entity: string; method: string; permission: string };

const ENTITY_OPS: EntityOp[] = [
  { entity: "Member", method: "GET", permission: "members:read" },
  { entity: "Alliance", method: "GET", permission: "alliance:read" },
  { entity: "User", method: "GET", permission: "auth:read" },
  { entity: "DesertStormEvent", method: "GET", permission: "events:read" },
  { entity: "DesertStormScore", method: "GET", permission: "events:read" },
  { entity: "DesertStormScore", method: "POST", permission: "events:write" },
  { entity: "CanyonStormEvent", method: "GET", permission: "events:read" },
  { entity: "CanyonStormScore", method: "GET", permission: "events:read" },
  { entity: "CanyonStormScore", method: "POST", permission: "events:write" },
  { entity: "ZombieSiegeEvent", method: "GET", permission: "events:read" },
  { entity: "ZombieSiegeScore", method: "GET", permission: "events:read" },
  { entity: "ZombieSiegeScore", method: "POST", permission: "events:write" },
  { entity: "SeasonalEvent", method: "GET", permission: "events:read" },
  { entity: "SeasonalEvent", method: "POST", permission: "events:write" },
  { entity: "SeasonalEvent", method: "PUT", permission: "events:write" },
  { entity: "SeasonalScore", method: "GET", permission: "events:read" },
  { entity: "SeasonalScore", method: "POST", permission: "events:write" },
  { entity: "EventSeries", method: "GET", permission: "events:read" },
  { entity: "EventSeries", method: "POST", permission: "events:write" },
  { entity: "AllianceExercise", method: "GET", permission: "scores:read" },
  { entity: "AllianceExerciseScore", method: "GET", permission: "scores:read" },
  { entity: "AllianceExerciseScore", method: "POST", permission: "scores:write" },
  { entity: "VSScore", method: "GET", permission: "scores:read" },
  { entity: "VSScore", method: "POST", permission: "scores:write" },
  { entity: "VSScore", method: "PUT", permission: "scores:write" },
  { entity: "Donation", method: "GET", permission: "scores:read" },
  { entity: "Donation", method: "POST", permission: "scores:write" },
];

const FUNCTION_OPS: Array<{ name: string; permission: string }> = [
  { name: "getSeasonalEvents", permission: "events:read" },
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

export function resolveFunctionPermission(name: string): string | null {
  return FUNCTION_OPS.find((op) => op.name === name)?.permission ?? null;
}

export function resolveIntegrationPermission(action: string): string | null {
  return INTEGRATION_OPS.find((op) => op.name === action)?.permission ?? null;
}

/** @deprecated Use sessionHasPermission from @/lib/rbac/context in route handlers. */
export function isAllowedPermission(permission: string | null): boolean {
  void permission;
  return true;
}

export function decodeIntegrationAction(encoded: string): string {
  return encoded.replace(/--/g, "/");
}

export function encodeIntegrationAction(action: string): string {
  return action.replace(/\//g, "--");
}
