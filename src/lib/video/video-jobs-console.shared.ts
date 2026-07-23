/** Shared routing + API config for admin and alliance processor video job consoles. */
export type VideoJobsConsoleConfig = {
  apiBase: string;
  listPath: "/admin/video-jobs" | "/tools/video-jobs";
  analyticsPath: "/admin/video-jobs/analytics" | "/tools/video-jobs/analytics";
  showFleetAdminLinks: boolean;
  includeRosterOcrEval: boolean;
  /** Admin-only Tessaract bbox / row-fingerprint deposit-slip eval dashboard. */
  includeDepositSlipOcrEval: boolean;
};

export const ADMIN_VIDEO_JOBS_CONSOLE: VideoJobsConsoleConfig = {
  apiBase: "/api/admin/video-jobs",
  listPath: "/admin/video-jobs",
  analyticsPath: "/admin/video-jobs/analytics",
  showFleetAdminLinks: true,
  includeRosterOcrEval: true,
  includeDepositSlipOcrEval: true,
};

export const TOOLS_VIDEO_JOBS_CONSOLE: VideoJobsConsoleConfig = {
  apiBase: "/api/tools/video-jobs",
  listPath: "/tools/video-jobs",
  analyticsPath: "/tools/video-jobs/analytics",
  showFleetAdminLinks: false,
  includeRosterOcrEval: false,
  includeDepositSlipOcrEval: false,
};
