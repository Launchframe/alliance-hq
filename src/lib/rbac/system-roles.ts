import { ROLE_IDS, type SystemRoleName } from "./constants";

export const SYSTEM_ROLE_NAMES = Object.keys(ROLE_IDS) as SystemRoleName[];

const ROLE_ID_SET = new Set<string>(Object.values(ROLE_IDS));

export function isSystemRoleId(roleId: string): boolean {
  // #region agent log
  const result = ROLE_ID_SET.has(roleId);
  fetch("http://127.0.0.1:7685/ingest/a19db502-b55d-438f-8e5d-f1296113f8f3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "d58882",
    },
    body: JSON.stringify({
      sessionId: "d58882",
      runId: "post-fix",
      hypothesisId: "H1-H2",
      location: "system-roles.ts:isSystemRoleId",
      message: "isSystemRoleId check",
      data: { roleId, result, setSize: ROLE_ID_SET.size },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  return result;
  // #endregion
}

export function systemRoleIdForName(name: SystemRoleName): string {
  return ROLE_IDS[name];
}

export function systemRoleNameForId(roleId: string): SystemRoleName | null {
  const entry = Object.entries(ROLE_IDS).find(([, id]) => id === roleId);
  return (entry?.[0] as SystemRoleName | undefined) ?? null;
}
