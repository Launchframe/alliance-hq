import {
  defaultRosterColumnVisibility,
  ROSTER_COLUMN_IDS,
  rosterColumnAlwaysVisible,
  type RosterColumnId,
  type RosterColumnVisibilityOptions,
} from "@/lib/members/roster-index.shared";

export const ROSTER_COLUMN_PREFS_KEY = "alliance-hq-roster-columns-v2";
export const LEGACY_ROSTER_COLUMN_PREFS_KEY = "alliance-hq-roster-columns-v1";

export type RosterColumnPrefs = Partial<Record<RosterColumnId, boolean>>;

function isRosterColumnId(value: unknown): value is RosterColumnId {
  return (
    typeof value === "string" &&
    (ROSTER_COLUMN_IDS as readonly string[]).includes(value)
  );
}

export function parseRosterColumnPrefs(raw: string | null): RosterColumnPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const prefs: RosterColumnPrefs = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isRosterColumnId(key) && typeof value === "boolean") {
        prefs[key] = value;
      }
    }
    return prefs;
  } catch {
    return null;
  }
}

/**
 * v1 saved every column, so its `previousNames: true` would mask the new
 * hidden default; carry the other choices forward without it.
 */
export function migrateLegacyRosterColumnPrefs(
  legacy: RosterColumnPrefs | null,
): RosterColumnPrefs | null {
  if (!legacy) return null;
  const migrated = { ...legacy };
  delete migrated.previousNames;
  return migrated;
}

export function readStoredRosterColumnPrefs(): RosterColumnPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const current = parseRosterColumnPrefs(
      localStorage.getItem(ROSTER_COLUMN_PREFS_KEY),
    );
    if (current) return current;
    return migrateLegacyRosterColumnPrefs(
      parseRosterColumnPrefs(
        localStorage.getItem(LEGACY_ROSTER_COLUMN_PREFS_KEY),
      ),
    );
  } catch {
    return null;
  }
}

export function writeStoredRosterColumnPrefs(
  visibility: Record<RosterColumnId, boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      ROSTER_COLUMN_PREFS_KEY,
      JSON.stringify(visibility),
    );
    localStorage.removeItem(LEGACY_ROSTER_COLUMN_PREFS_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveRosterColumnVisibility(
  options: RosterColumnVisibilityOptions,
  stored: RosterColumnPrefs | null = readStoredRosterColumnPrefs(),
): Record<RosterColumnId, boolean> {
  const defaults = defaultRosterColumnVisibility(options);
  const resolved = { ...defaults };

  if (stored) {
    for (const columnId of ROSTER_COLUMN_IDS) {
      if (typeof stored[columnId] === "boolean") {
        resolved[columnId] = stored[columnId]!;
      }
    }
  }

  resolved.name = true;
  if (!options.showSquadEdit) {
    resolved.squadEdit = false;
  }

  return resolved;
}

export function toggleRosterColumnVisibility(
  visibility: Record<RosterColumnId, boolean>,
  columnId: RosterColumnId,
  nextVisible: boolean,
): Record<RosterColumnId, boolean> {
  if (rosterColumnAlwaysVisible(columnId)) {
    return visibility;
  }
  return {
    ...visibility,
    [columnId]: nextVisible,
  };
}
