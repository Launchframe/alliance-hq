export const LASTWAR_UID_SUFFIX = "1203";

export function isValidGameUid(uid: string): boolean {
  const trimmed = uid.trim();
  if (!/^\d{12,16}$/.test(trimmed)) return false;
  return trimmed.endsWith(LASTWAR_UID_SUFFIX);
}

export type LastWarPlayerLookupResponse = {
  code: number;
  message?: string;
  data?: {
    gameUserName?: string;
    userName?: string;
  };
};

export type LastWarPlayerLookupResult =
  | { ok: true; gameUserName: string }
  | { ok: false; reason: "invalid_uid" | "not_found" | "request_failed"; message: string };

export function parseLastWarLookupResponse(
  body: LastWarPlayerLookupResponse,
): LastWarPlayerLookupResult {
  if (body.code === 103) {
    return {
      ok: false,
      reason: "not_found",
      message: "That UID was not found. Double-check your UID and try again.",
    };
  }
  if (body.code !== 0 && body.code !== 200) {
    return {
      ok: false,
      reason: "request_failed",
      message: body.message ?? "Player lookup failed.",
    };
  }
  const gameUserName = body.data?.gameUserName ?? body.data?.userName;
  if (!gameUserName?.trim()) {
    return {
      ok: false,
      reason: "request_failed",
      message: "Player lookup returned no name.",
    };
  }
  return { ok: true, gameUserName: gameUserName.trim() };
}

export async function lookupPlayerByUid(
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LastWarPlayerLookupResult> {
  if (!isValidGameUid(uid)) {
    return {
      ok: false,
      reason: "invalid_uid",
      message:
        "UID must be 12–16 digits and end in 1203 (copy it from your in-game profile).",
    };
  }

  const baseUrl =
    process.env.LASTWAR_PLAYER_LOOKUP_URL?.trim() ??
    "https://lastwar-h5.lastwargame.com/api/player/info";
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}uid=${encodeURIComponent(uid.trim())}`;

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = (await res.json()) as LastWarPlayerLookupResponse;
    return parseLastWarLookupResponse(body);
  } catch {
    return {
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server. Try again in a moment.",
    };
  }
}
