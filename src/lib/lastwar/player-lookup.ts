import { isUidBypassEnabled } from "@/lib/dev/env-guard";
import {
  E2E_CLAIM_INVITE_MIRROR_UID,
  lookupPlayerUidBypass,
} from "@/lib/lastwar/player-lookup-bypass.shared";

export { E2E_CLAIM_INVITE_MIRROR_UID } from "@/lib/lastwar/player-lookup-bypass.shared";

const GAME_UID_PATTERN = /^\d{12,16}$/;

export function isValidGameUid(uid: string): boolean {
  return GAME_UID_PATTERN.test(uid.trim());
}

export const INVALID_GAME_UID_MESSAGE =
  "Enter a 12–16 digit player ID from your in-game profile.";

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
  | {
      ok: true;
      gameUserName: string;
      gameUserLevel?: number;
      avatarUrl?: string;
      gameServerNumber?: number;
    }
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

export function parseGameServerNumberFromUid(uid: string): number | null {
  const trimmed = uid.trim();
  if (!/^\d{12,16}$/.test(trimmed)) return null;
  const suffix = trimmed.slice(-4);
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isClaimInviteMirrorDevUid(uid: string): boolean {
  return isUidBypassEnabled() && uid.trim() === E2E_CLAIM_INVITE_MIRROR_UID;
}

export function parseLastWarGameServerNumber(
  payload: LastWarPlayerPayload | undefined,
  uid?: string,
): number | null {
  const raw = payload?.server;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      if (parsed > 0) return parsed;
    }
  }
  if (uid) {
    return parseGameServerNumberFromUid(uid);
  }
  return null;
}

export function parseLastWarLookupResponse(
  body: LastWarPlayerLookupResponse,
  uid?: string,
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
  const gameServerNumber =
    parseLastWarGameServerNumber(payload, uid) ?? undefined;
  return {
    ok: true,
    gameUserName: gameUserName.trim(),
    ...(gameUserLevel != null ? { gameUserLevel } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(gameServerNumber != null ? { gameServerNumber } : {}),
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
      message: INVALID_GAME_UID_MESSAGE,
    };
  }

  if (isUidBypassEnabled()) {
    const bypass = lookupPlayerUidBypass(uid);
    if (bypass) {
      return bypass;
    }
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
    return parseLastWarLookupResponse(body, uid.trim());
  } catch {
    return {
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server. Try again in a moment.",
    };
  }
}
