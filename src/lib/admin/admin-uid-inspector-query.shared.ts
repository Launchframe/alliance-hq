import { isValidGameUid } from "@/lib/lastwar/player-lookup";

export type AdminUidInspectorQueryParams = {
  gameUid?: string;
  allianceIdForRoster?: string;
};

export function parseAdminUidInspectorQueryParams(
  searchParams: URLSearchParams,
): AdminUidInspectorQueryParams {
  const gameUidRaw = searchParams.get("gameUid")?.trim();
  const gameUid = gameUidRaw ? gameUidRaw.replace(/\s+/g, "") : undefined;

  return {
    gameUid: gameUid || undefined,
    allianceIdForRoster:
      searchParams.get("allianceIdForRoster")?.trim() || undefined,
  };
}

export function buildAdminUidInspectorSearchParams(
  params: AdminUidInspectorQueryParams,
): string {
  const qs = new URLSearchParams();
  if (params.gameUid) qs.set("gameUid", params.gameUid);
  if (params.allianceIdForRoster) {
    qs.set("allianceIdForRoster", params.allianceIdForRoster);
  }
  return qs.toString();
}

export function validateAdminUidInspectorGameUid(
  gameUid: string | undefined,
): { ok: true; gameUid: string } | { ok: false; error: "missing" | "invalid" } {
  if (!gameUid?.trim()) {
    return { ok: false, error: "missing" };
  }
  const normalized = gameUid.trim().replace(/\s+/g, "");
  if (!isValidGameUid(normalized)) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, gameUid: normalized };
}
