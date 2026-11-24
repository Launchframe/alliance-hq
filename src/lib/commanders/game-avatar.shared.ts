import { LASTWAR_AVATAR_TTL_MS } from "@/lib/profile/avatar-ttl.shared";

export function isCommanderGameAvatarStale(
  refreshedAt: Date | null | undefined,
): boolean {
  if (!refreshedAt) return true;
  return Date.now() - refreshedAt.getTime() > LASTWAR_AVATAR_TTL_MS;
}
