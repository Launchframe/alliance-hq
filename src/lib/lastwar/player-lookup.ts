export const LASTWAR_UID_SUFFIX = "1203";

export function isValidGameUid(uid: string): boolean {
  const trimmed = uid.trim();
  if (!/^\d{12,16}$/.test(trimmed)) return false;
  return trimmed.endsWith(LASTWAR_UID_SUFFIX);
}

export type LastWarPlayerLookupResponse = {
  code: number;
  message?: string;
  data?: LastWarPlayerPayload;
  /** Current Last War platform API (`redemptionCode.php?method=login`). */
  result?: LastWarPlayerPayload;
};

type LastWarPlayerPayload = {
  gameUserName?: string;
  userName?: string;
  server?: string;
  gameUserLevel?: string;
  headPic?: string;
  avatar?: string;
  picUrl?: string;
  userPic?: string;
  headImg?: string;
  portrait?: string;
  photo?: string;
  avatarUrl?: string;
  [key: string]: unknown;
};

export type LastWarPlayerLookupResult =
  | { ok: true; gameUserName: string; gameUserLevel?: number; avatarUrl?: string }
  | { ok: false; reason: "invalid_uid" | "not_found" | "request_failed"; message: string };

const LASTWAR_AVATAR_FIELD_KEYS = [
  "headPic",
  "avatar",
  "picUrl",
  "userPic",
  "headImg",
  "portrait",
  "photo",
  "avatarUrl",
] as const;

const LASTWAR_AVATAR_BASE_URL =
  process.env.LASTWAR_AVATAR_BASE_URL?.trim() ??
  "https://lastwar-h5.lastwargame.com";

export function normalizeLastWarAvatarUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("/")) {
    return `${LASTWAR_AVATAR_BASE_URL}${trimmed}`;
  }
  return undefined;
}

export function parseLastWarAvatarUrl(
  data: LastWarPlayerPayload | undefined,
): string | undefined {
  if (!data) return undefined;
  for (const key of LASTWAR_AVATAR_FIELD_KEYS) {
    const value = data[key];
    if (typeof value === "string") {
      const normalized = normalizeLastWarAvatarUrl(value);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

export function parseLastWarGameUserLevel(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return rounded >= 1 ? rounded : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return parsed >= 1 ? parsed : null;
  }
  return null;
}

export function parseLastWarLookupResponse(
  body: LastWarPlayerLookupResponse,
): LastWarPlayerLookupResult {
  if (body.code !== 0 && body.code !== 200) {
    return {
      ok: false,
      reason: body.code === 103 ? "not_found" : "request_failed",
      message:
        body.code === 103
          ? "That UID was not found. Double-check your UID and try again."
          : (body.message ?? "Player lookup failed."),
    };
  }
  const payload = body.result ?? body.data;
  const gameUserName = payload?.gameUserName ?? payload?.userName;
  if (!gameUserName?.trim()) {
    return {
      ok: false,
      reason: "not_found",
      message: "That UID was not found. Double-check your UID and try again.",
    };
  }
  const avatarUrl = parseLastWarAvatarUrl(payload);
  const gameUserLevel = parseLastWarGameUserLevel(payload?.gameUserLevel);
  return {
    ok: true,
    gameUserName: gameUserName.trim(),
    ...(gameUserLevel != null ? { gameUserLevel } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

const DEFAULT_LASTWAR_PLAYER_LOOKUP_URL =
  "https://lastwar-platform.lastwargame.com/redemptionCode.php?method=login";

export function buildLastWarPlayerLookupUrl(uid: string): string {
  const base =
    process.env.LASTWAR_PLAYER_LOOKUP_URL?.trim() ?? DEFAULT_LASTWAR_PLAYER_LOOKUP_URL;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}uid=${encodeURIComponent(uid.trim())}`;
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

  const url = buildLastWarPlayerLookupUrl(uid);

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = (await res.json()) as LastWarPlayerLookupResponse;
    if (!res.ok) {
      return {
        ok: false,
        reason: "request_failed",
        message: body.message ?? "Player lookup failed.",
      };
    }
    return parseLastWarLookupResponse(body);
  } catch {
    return {
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server. Try again in a moment.",
    };
  }
}
