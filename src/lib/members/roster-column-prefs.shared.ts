import {
  defaultRosterColumnVisibility,
  ROSTER_COLUMN_IDS,
  rosterColumnAlwaysVisible,
  type RosterColumnId,
  type RosterColumnVisibilityOptions,
} from "@/lib/members/roster-index.shared";

export const ROSTER_COLUMN_PREFS_KEY = "alliance-hq-roster-columns-v1";

export type RosterColumnPrefs = Partial<Record<RosterColumnId, boolean>>;

function isRosterColumnId(value: unknown): value is RosterColumnId {
  return (
    typeof value === "string" &&
    (ROSTER_COLUMN_IDS as readonly string[]).includes(value)
  );
}

export function readStoredRosterColumnPrefs(): RosterColumnPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ROSTER_COLUMN_PREFS_KEY);
    if (!raw) return null;
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

export function writeStoredRosterColumnPrefs(
  visibility: Record<RosterColumnId, boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      ROSTER_COLUMN_PREFS_KEY,
      JSON.stringify(visibility),
    );
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
