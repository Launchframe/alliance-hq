/** Client-safe Commander identity conflict helpers (no DB imports). */

export const COMMANDER_SYNC_STATUS = {
  SYNCED: "synced",
  PENDING: "pending",
  NAME_CONFLICT: "name_conflict",
  MISSING_SERVER: "missing_server",
} as const;

export type CommanderSyncStatus =
  (typeof COMMANDER_SYNC_STATUS)[keyof typeof COMMANDER_SYNC_STATUS];

export type CommanderIdentityConflictCode =
  | "duplicate_in_batch"
  | "name_taken_by_other_member";

export type CommanderIdentityConflict = {
  code: CommanderIdentityConflictCode;
  ashedMemberId?: string;
  rowIndex?: number;
  normalizedName: string;
  gameServerNumber: number;
  existingCommanderId?: string;
  existingMemberName?: string;
};

export type CommanderConflictReasonJson = {
  code: CommanderIdentityConflictCode;
  normalizedName: string;
  gameServerNumber: number;
  existingCommanderId?: string;
  existingMemberName?: string;
};

export type RosterImportNameRow = {
  extractedName: string;
  matchMemberId?: string | null;
  rowIndex?: number;
};

/** Trim, collapse whitespace, lowercase — Last War names are unique per server when exact. */
export function normalizeCommanderName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function detectBatchNameConflicts(
  rows: RosterImportNameRow[],
  gameServerNumber: number,
): CommanderIdentityConflict[] {
  const conflicts: CommanderIdentityConflict[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const normalized = normalizeCommanderName(row.extractedName);
    if (!normalized) return;

    const firstIndex = seen.get(normalized);
    if (firstIndex !== undefined) {
      if (
        !conflicts.some(
          (c) =>
            c.code === "duplicate_in_batch" && c.rowIndex === firstIndex,
        )
      ) {
        conflicts.push({
          code: "duplicate_in_batch",
          rowIndex: firstIndex,
          normalizedName: normalized,
          gameServerNumber,
        });
      }
      conflicts.push({
        code: "duplicate_in_batch",
        rowIndex: row.rowIndex ?? index,
        normalizedName: normalized,
        gameServerNumber,
      });
      return;
    }

    seen.set(normalized, row.rowIndex ?? index);
  });

  return conflicts;
}

export function commanderConflictResponseBody(
  conflicts: CommanderIdentityConflict[],
) {
  return {
    code: "commander_identity_conflicts" as const,
    conflicts,
  };
}

export class CommanderIdentityConflictError extends Error {
  readonly code = "commander_identity_conflicts" as const;

  constructor(readonly conflicts: CommanderIdentityConflict[]) {
    super("commander_identity_conflicts");
    this.name = "CommanderIdentityConflictError";
  }
}
