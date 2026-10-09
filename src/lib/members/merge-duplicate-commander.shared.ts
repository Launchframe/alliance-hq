export const MERGE_DUPLICATE_ERROR_CODES = [
  "same_member",
  "not_active",
  "different_server",
  "conflicting_links",
] as const;

export type MergeDuplicateErrorCode = (typeof MERGE_DUPLICATE_ERROR_CODES)[number];

/** i18n key under `members.mergeCommander.errors`. */
export function mergeDuplicateErrorKey(
  code: MergeDuplicateErrorCode | "generic",
): "sameMember" | "notActive" | "differentServer" | "conflictingLinks" | "generic" {
  switch (code) {
    case "same_member":
      return "sameMember";
    case "not_active":
      return "notActive";
    case "different_server":
      return "differentServer";
    case "conflicting_links":
      return "conflictingLinks";
    case "generic":
      return "generic";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

export function isMergeDuplicateErrorCode(
  value: unknown,
): value is MergeDuplicateErrorCode {
  return (
    typeof value === "string" &&
    (MERGE_DUPLICATE_ERROR_CODES as readonly string[]).includes(value)
  );
}

export type MergeSide = {
  ashedMemberId: string;
  rosterStatus: string;
  commanderId: string | null;
  gameServerNumber: number | null;
  gameUid: string | null;
  lastrankPublicId: number | null;
  /** HQ users linked via hq_member_links or hq_user_commanders. */
  hqUserIds: string[];
  discordUserId: string | null;
};

function distinctNonNull<T>(a: T | null, b: T | null): boolean {
  return a != null && b != null && a !== b;
}

/**
 * Decide whether `duplicate` can be folded into `kept`. Two different game
 * identities (UID, game-data id, or owning accounts) are never merged.
 */
export function evaluateMergeEligibility(
  kept: MergeSide,
  duplicate: MergeSide,
): { ok: true } | { ok: false; code: MergeDuplicateErrorCode } {
  if (kept.ashedMemberId === duplicate.ashedMemberId) {
    return { ok: false, code: "same_member" };
  }
  if (
    kept.commanderId != null &&
    kept.commanderId === duplicate.commanderId
  ) {
    return { ok: false, code: "same_member" };
  }
  if (
    kept.rosterStatus === "former" ||
    duplicate.rosterStatus === "former" ||
    kept.commanderId == null ||
    duplicate.commanderId == null
  ) {
    return { ok: false, code: "not_active" };
  }
  if (distinctNonNull(kept.gameServerNumber, duplicate.gameServerNumber)) {
    return { ok: false, code: "different_server" };
  }
  if (
    distinctNonNull(kept.gameUid, duplicate.gameUid) ||
    distinctNonNull(kept.lastrankPublicId, duplicate.lastrankPublicId) ||
    distinctNonNull(kept.discordUserId, duplicate.discordUserId)
  ) {
    return { ok: false, code: "conflicting_links" };
  }
  const keptUsers = new Set(kept.hqUserIds);
  if (
    keptUsers.size > 0 &&
    duplicate.hqUserIds.some((id) => !keptUsers.has(id))
  ) {
    return { ok: false, code: "conflicting_links" };
  }
  return { ok: true };
}

/**
 * The kept member adopts the duplicate's current (live in-game) name. Its own
 * old name and both sets of previous names are preserved, deduplicated.
 */
export function mergedPreviousNames(input: {
  keptCurrentName: string;
  keptPreviousNames: string[];
  duplicatePreviousNames: string[];
  newName: string;
}): string[] {
  const out: string[] = [];
  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === input.newName || out.includes(trimmed)) return;
    out.push(trimmed);
  };
  input.keptPreviousNames.forEach(add);
  add(input.keptCurrentName);
  input.duplicatePreviousNames.forEach(add);
  return out;
}

/** True when the duplicate's value should replace the kept one. */
export function duplicateValueIsNewer(input: {
  keptValuePresent: boolean;
  duplicateValuePresent: boolean;
  keptUpdatedAt: Date | null;
  duplicateUpdatedAt: Date | null;
}): boolean {
  if (!input.duplicateValuePresent) return false;
  if (!input.keptValuePresent) return true;
  if (!input.duplicateUpdatedAt) return false;
  if (!input.keptUpdatedAt) return true;
  return input.duplicateUpdatedAt.getTime() > input.keptUpdatedAt.getTime();
}
