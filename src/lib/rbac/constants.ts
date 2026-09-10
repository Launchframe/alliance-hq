/** System role ids — must match scripts/rbac/seed.mjs */
export const ROLE_IDS = {
  owner: "role-owner",
  maintainer: "role-maintainer",
  officer: "role-officer",
  data_entry: "role-data-entry",
  viewer: "role-viewer",
  member: "role-member",
} as const;

export type SystemRoleName = keyof typeof ROLE_IDS;

/** HQ-native permissions beyond Ashed catalog */
export const HQ_PERMISSIONS = [
  { id: "plunder_plan:read", description: "Plunder Plan" },
  { id: "plunder_plan:self", description: "My Plunder Plans" },
  { id: "plunder_plan:suggest", description: "Suggest a time" },
  { id: "hq:admin", description: "Platform maintainer — cross-alliance admin portal" },
  { id: "hq:audit:read", description: "Read alliance audit log" },
  { id: "hq:video:read", description: "List alliance video jobs" },
  { id: "hq:video:enqueue", description: "Upload and queue video jobs for processing" },
  { id: "hq:video:process", description: "Approve and run OCR on queued alliance video jobs" },
  { id: "hq:events:write", description: "Manage HQ native events" },
  { id: "trains:write", description: "Manage train conductor schedule, rolls, and locks" },
  { id: "ashed:connect", description: "Connect an Ashed account to HQ" },
  { id: "inbox:read", description: "View alliance reminder inbox" },
  { id: "eur:schedules:write", description: "Manage event upload reminder schedules" },
  { id: "battle_plan:read", description: "View alliance battle plan schedule" },
  { id: "battle_plan:write", description: "Manage alliance battle plan schedule" },
  { id: "bank:read", description: "View alliance bank strongholds and deposit risk" },
  { id: "bank:write", description: "Manage alliance bank strongholds and deposit slips" },
  { id: "support_teams:read", description: "Support teams" },
  { id: "support_teams:write", description: "Support teams" },
  { id: "time_off:read", description: "View alliance time-off calendar" },
  { id: "time_off:write", description: "Manage time-off entries for alliance members" },
  { id: "vs_compliance:read", description: "VS compliance" },
  { id: "vs_compliance:manage", description: "Confirm in-game action" },
  { id: "vs_compliance:settings", description: "VS membership minimums" },
  { id: "officer_intel:read", description: "View officer intelligence sessions and ingested chat" },
  { id: "officer_intel:write", description: "Upload and manage officer intelligence chat sessions" },
] as const;

export const VS_COMPLIANCE_READ_PERMISSION = "vs_compliance:read";
export const VS_COMPLIANCE_MANAGE_PERMISSION = "vs_compliance:manage";
export const VS_COMPLIANCE_SETTINGS_PERMISSION = "vs_compliance:settings";

export const BATTLE_PLAN_READ_PERMISSION = "battle_plan:read";
export const BATTLE_PLAN_WRITE_PERMISSION = "battle_plan:write";

export const BANK_READ_PERMISSION = "bank:read";
export const BANK_WRITE_PERMISSION = "bank:write";

export const TIME_OFF_READ_PERMISSION = "time_off:read";
export const TIME_OFF_WRITE_PERMISSION = "time_off:write";

export const OFFICER_INTEL_READ_PERMISSION = "officer_intel:read";
export const OFFICER_INTEL_WRITE_PERMISSION = "officer_intel:write";

export const TRAINS_WRITE_PERMISSION = "trains:write";

/** Upload + queue a video job (no Ashed credential required). */
export const VIDEO_ENQUEUE_PERMISSION = "hq:video:enqueue";

/** Approve and run OCR on queued jobs (requires a live Ashed credential at run time). */
export const VIDEO_PROCESS_PERMISSION = "hq:video:process";

/** List alliance video jobs / queue. */
export const VIDEO_READ_PERMISSION = "hq:video:read";

/**
 * Permission that gates Ashed connection attempts. All system roles receive it
 * at seed time; embed routes still require an active Ashed credential.
 */
export const ASHED_CONNECT_PERMISSION = "ashed:connect";

/** Permissions that satisfy alliance admin UI gates */
export const ALLIANCE_ADMIN_PERMISSION = "alliance:admin";
