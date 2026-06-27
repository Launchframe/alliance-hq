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
] as const;

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
